# Security

Agent Watch is a local single-owner control plane, not a hostile multi-tenant sandbox. The Docker daemon, host administrator, runtime image, configured workspace, and gateway process are trusted. Keep Docker patched. Container isolation reduces access but is not a defense against every kernel or runtime exploit.

## Enforced boundaries

- Loopback-only gateway, bearer authentication, strict Host/Origin validation, no CORS.
- Workspace mount configured by the server operator, never accepted from a browser request.
- Read-only root filesystem; workspace read-only unless approved policy enables writes.
- Network none or bridge. Bridge permits unrestricted egress and reachable local services.
- No host home, credentials directory, or Docker socket mount.
- Capabilities dropped, no-new-privileges, PID/CPU/memory/time limits.
- Immutable per-run policy snapshot; whole-run approval for write/network access.
- Restart reconciliation stops known active containers. If Docker cannot be reached, startup fails closed.

The gateway must remain alive for runtime deadlines to be enforced. A crashed gateway can leave a container running until it restarts. Run it under a process supervisor with automatic restart for unattended use. A Docker daemon outage may prevent intervention; the UI must not be treated as proof of termination when a stop action fails.

## Audit and secrets

The local file contains tasks and model output, potentially including repository content. Files are owner-readable only. Known provider credentials and common secret patterns are redacted, but arbitrary secrets or fragmented output may evade filters. Exports remain sensitive. Agent processes can read their own provider API credentials. The public demo contains only synthetic data.

Event hashes detect modifications to a retained chain, not a full administrative rewrite or truncation. Back up exports and retain their final hashes outside the gateway. The local JSON store and token are ignored by Git. Never force-add `.agent-watch`, `.env`, or private workspace contents.

## Missing controls

No per-domain allowlist, per-command approval, file-level ACLs, external credential broker, multi-user roles, automatic rollback, or tamper-proof external ledger. Do not use the product as a compliance certification or a production multi-tenant security boundary.

Report vulnerabilities privately through GitHub private vulnerability reporting if enabled. Otherwise contact the repository owner without including credentials or confidential logs in a public issue.
