# Agent Watch

An open-source control room for AI agents: see active work, constrain workspace and network access, approve runs, pause or stop execution, and inspect a persistent audit trail.

**Public demo:** https://agent-watch-james.jajamjamjamijamiejamie.chatgpt.site

The public site runs a browser-local simulator. **Actual enforcement runs locally through Docker.** The same dashboard connects to the gateway when opened with `?local=1`. No production dependencies or build framework are required.

## Quick start — free, no API keys

Requirements: macOS or Linux, Node.js 22+, and a running Docker engine. Docker Desktop licensing depends on your organization; an existing Docker Engine or compatible free alternative works. No hosted backend, subscription, or paid model call is required for the sandbox probe.

```sh
git clone https://github.com/Jameslovecs/agent-watch.git
cd agent-watch
npm run image
npm start
```

Open **http://127.0.0.1:4310/?local=1**. In a separate terminal, read your local gateway token and paste it into the login form:

```sh
cat .agent-watch/access-token
```

1. Click **Launch agent** and choose **Sandbox probe** with the **Observer** policy.
2. Watch real container output. The probe attempts a workspace write; the read-only mount blocks it.
3. Pause, resume, or stop the container from the inspector.
4. Launch another probe with **Offline builder**. It stays pending until approved, then writes `agent-watch-probe.txt` into the test workspace.
5. Open **Audit log**, filter by run, and export the records.

The probe runs for approximately 30 seconds, making no model requests. Its task field labels the run; it always performs the same deterministic boundary checks.

## Connect Codex or Claude

The runner image pins Codex CLI `0.172.0` and Claude Code `2.1.331`. Both are installed in the container; host CLI installations are not used. The gateway accepts only these built-in adapters and the probe. It does not import existing chats or discover processes started elsewhere.

Use a **dedicated checkout without secrets**. Every file inside the mounted workspace is readable, even under Observer. Never select your home directory as the workspace. Model provider credentials are passed only to the matching runtime via Docker's environment forwarding; they are not put into command arguments or source files. Docker administrators can still inspect container environments, and agent subprocesses inherit the runtime's credential.

**Provider API usage may cost money.** The project never provisions billing or purchases credits. Configure credentials only when you intend to use your existing provider account. No paid model calls were made in the shipped verification.

For Codex, set `CODEX_API_KEY` in the gateway's environment. For Claude, set `ANTHROPIC_API_KEY`. To enter a key without putting it into shell history, use a hidden prompt (bash syntax):

```bash
read -r -s -p 'Codex API key: ' CODEX_API_KEY; echo
export CODEX_API_KEY
AGENT_WATCH_WORKSPACE=/absolute/path/to/dedicated-checkout npm start
```

For zsh, use `read -rs 'CODEX_API_KEY?Codex API key: '` followed by `export CODEX_API_KEY`. Substitute `ANTHROPIC_API_KEY` for Claude. Do not paste credentials into task descriptions, commit them, or save them in repository files.

Select the runtime, enter a task, choose a network-enabled policy, and approve its exact access scope. Create a read-only network policy by editing Observer if desired. The default Connected builder allows writes and **unrestricted** outbound access, including services reachable from the container. It is not a provider-only network allowlist.

The adapters use non-interactive JSON output:

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/): `codex exec --json`.
- [Claude programmatic mode](https://code.claude.com/docs/en/headless): `claude --bare -p --output-format stream-json --verbose`.

Both bypass their interactive permission prompts **inside the Docker boundary**. This makes Docker and the approved run policy the enforcement layer. Claude bare mode avoids project hooks and MCP auto-discovery. Do not add Docker socket mounts, host credential mounts, privileged mode, or host networking.

## Features

| Area         | Behavior                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Fleet        | Live local run state, search, filters, task details, elapsed time, captured runtime output            |
| Policies     | Workspace read-only/read-write, network none/bridge, 10–3600 second runtime limit                     |
| Approvals    | Whole-run approval before any write-enabled or network-enabled launch                                 |
| Intervention | Docker pause, unpause, force stop, and emergency stop including pending requests                      |
| Audit        | Durable JSON store, SHA-256 linked events, startup integrity verification, searchable UI, JSON export |
| Recovery     | Gateway restart stops previously active managed containers before accepting work                      |
| Public demo  | Browser-local simulation, editable policies, launch/approve/deny/pause/stop, export and reset         |

Policies are snapshotted at request time. Editing a template cannot expand permissions on an active **or pending** run. Deny and create a new request if a pending run needs different permissions. There are no temporary grants or per-tool approvals in this release.

## Configuration

| Variable                | Default                             | Purpose                                     |
| ----------------------- | ----------------------------------- | ------------------------------------------- |
| `PORT`                  | `4310`                              | Local dashboard port                        |
| `AGENT_WATCH_WORKSPACE` | `sandbox-workspace` in the checkout | Sole host directory mounted into runs       |
| `AGENT_WATCH_DATA`      | `.agent-watch` in the checkout      | Private token, run state, and audit history |
| `AGENT_WATCH_IMAGE`     | `agent-watch-runner:1`              | Trusted local runner image                  |
| `CODEX_API_KEY`         | absent                              | Enable the Codex adapter                    |
| `ANTHROPIC_API_KEY`     | absent                              | Enable the Claude adapter                   |

Gateway binds to `127.0.0.1` only and rejects unexpected Host and Origin headers. API operations require a bearer token. The browser stores the token in sessionStorage until logout or the tab session ends. Data and token files are created with owner-only permissions. Do not reverse proxy this service onto the internet; it has one owner role and no multi-user authentication.

## Security model and limits

See [SECURITY.md](SECURITY.md) for the trust boundary and operational limits.

- Only gateway-launched containers are controlled. Existing desktop/CLI sessions are not attached.
- Docker mounts only the chosen workspace. The container root filesystem is read-only, Linux capabilities are dropped, privilege escalation is disabled, and CPU/memory/PID limits are set.
- Writable `/tmp` is private to the container. No host home directory or Docker socket is mounted.
- Network is either off or unrestricted. There is no domain allowlist, file-level rule, or tool allowlist.
- Approval authorizes a whole run. A shell command inside an approved run does not create a separate approval request.
- Pause freezes the container; timeout still counts paused time. Stop kills it and cannot undo completed file changes or external effects.
- Runtime output is captured with best-effort credential redaction, limited to 3,000 lines of 12,000 characters per run. Audit decisions are not subject to the output cap. This is not a complete syscall trace.
- Hash chaining detects changes inside the retained chain; an administrator can rewrite the entire chain or remove its tail. Store exports/checkpoints externally for stronger evidence.
- The single-process JSON store is intended for small local fleets, not high-throughput or multi-tenant deployment. Do not run two gateways against the same data directory.
- Live prompt steering, automatic rollback, automatic credential revocation, remote agent enrollment, and distributed durable storage are not implemented. Stop and relaunch a corrected task.
- Provider-authenticated end-to-end Codex/Claude work was intentionally not exercised to avoid paid usage. The image installation/version and container control flow were verified without model calls.

## Development and verification

```sh
npm test                 # Policy, audit persistence/tampering, redaction, sandbox command construction
npm run test:docker      # Real isolated containers; requires npm run image first
npm run build            # Copy web/ to dist/ for any static host
npm start                # Serve dashboard plus local gateway
```

The Docker integration suite creates a disposable workspace and separate gateway. It exercises authentication, hostile Origin/Host rejection, read-only mounts, network isolation, approval/denial, immutable policy snapshots, pause/resume/stop, emergency stop, crash recovery, and timeout. It only cleans up containers it created. GitHub Actions runs unit and Docker integration tests on public-repository hosted runners.

UI smoke verification covers launch, approvals, pause/resume, stop confirmation, policy edits, audit filtering/export, and responsive layout. The demo requires a modern browser and localStorage. Static hosting is sufficient for the demo; real Docker execution must remain local.

## Layout

```text
web/                     Dashboard and standalone demo adapter
server/index.mjs         Authenticated loopback API and container lifecycle
server/core.mjs          Policies, audit storage, redaction, Docker argument builder
server/probe.mjs         Free deterministic test agent
scripts/build.mjs        Static asset build
scripts/verify-audit.mjs  Offline export verifier
sandbox-workspace/       Dedicated default test workspace
```

## Troubleshooting

- **Docker unavailable / image missing:** start Docker, run `npm run image`, then use Setup → Check Docker readiness.
- **Run fails to write:** check the policy snapshot and host directory ownership. Linux containers run as your local numeric UID/GID (root hosts fall back to UID 1000).
- **Runtime missing:** restart the gateway after configuring its matching environment variable. A network-enabled policy is required.
- **Gateway disconnected:** restart `npm start`; the public demo never connects to your machine.
- **Audit integrity error:** preserve the data directory for investigation and restore a trusted backup. Do not delete records just to silence verification.
- **Lost token:** stop the gateway, remove only `.agent-watch/access-token`, and restart to generate a new token. Existing audit data remains.

MIT licensed. Public demo hosting and the local probe do not require paid model usage.
