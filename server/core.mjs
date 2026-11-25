import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
export const defaults = () => [
  {
    id: "observe",
    name: "Observer",
    description: "Inspect a workspace without changing it.",
    write: false,
    network: false,
    timeout: 300,
  },
  {
    id: "build",
    name: "Offline builder",
    description: "Edit one workspace. No network access.",
    write: true,
    network: false,
    timeout: 600,
  },
  {
    id: "connected",
    name: "Connected builder",
    description: "Edit one workspace with unrestricted outbound network.",
    write: true,
    network: true,
    timeout: 900,
  },
];
export function redact(value, secrets = []) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const s of secrets.filter((s) => s && s.length > 3))
    text = text.split(s).join("[REDACTED]");
  return text
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{15,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|authorization|password|token)\s*["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,
      "$1[REDACTED]",
    );
}
export function hashEvent(event) {
  const { hash, ...body } = event;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
export function verify(events) {
  let previous = "genesis";
  for (const e of events) {
    if (e.previous !== previous || hashEvent(e) !== e.hash) return false;
    previous = e.hash;
  }
  return true;
}
export class Store {
  constructor(dir, secrets = []) {
    this.dir = dir;
    this.secrets = secrets;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, "state.json");
    this.state = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : { runs: [], policies: defaults(), events: [] };
    if (!verify(this.state.events))
      throw Error(
        "Audit integrity check failed. Restore a trusted backup before starting.",
      );
  }
  save() {
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  event(type, message, runId = null, details = {}) {
    const safe = JSON.parse(
      redact(JSON.stringify({ message, details }), this.secrets),
    );
    const event = {
      id: randomUUID(),
      time: new Date().toISOString(),
      type,
      runId,
      ...safe,
      previous: this.state.events.at(-1)?.hash || "genesis",
    };
    event.hash = hashEvent(event);
    this.state.events.push(event);
    this.save();
    return event;
  }
}
export function validatePolicy(p) {
  if (
    typeof p.name !== "string" ||
    p.name.trim().length < 1 ||
    p.name.length > 60 ||
    typeof p.write !== "boolean" ||
    typeof p.network !== "boolean" ||
    !Number.isInteger(p.timeout) ||
    p.timeout < 10 ||
    p.timeout > 3600
  )
    throw Error(
      "Policy requires a name, boolean permissions, and a 10–3600 second timeout.",
    );
  return {
    id: p.id,
    name: p.name.trim(),
    description: String(p.description || "").slice(0, 200),
    write: p.write,
    network: p.network,
    timeout: p.timeout,
  };
}
export function dockerArgs(run, workspace, image) {
  const p = run.policy;
  const args = [
    "create",
    "--name",
    run.container,
    "--label",
    "agent-watch.managed=true",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=128",
    "--memory=1g",
    "--cpus=1",
    "--init",
    "--network",
    p.network ? "bridge" : "none",
    "--tmpfs",
    "/tmp:rw,nosuid,size=256m,mode=1777",
    "--user",
    `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
    "--workdir",
    "/workspace",
    "--mount",
    `type=bind,src=${workspace},dst=/workspace${p.write ? "" : ",readonly"}`,
    "-e",
    "HOME=/tmp/home",
  ];
  if (run.runtime === "codex") args.push("-e", "CODEX_API_KEY");
  if (run.runtime === "claude") args.push("-e", "ANTHROPIC_API_KEY");
  args.push(image);
  if (run.runtime === "codex")
    args.push(
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      run.task,
    );
  else if (run.runtime === "claude")
    args.push(
      "claude",
      "--bare",
      "-p",
      run.task,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    );
  else args.push("node", "/opt/agent-watch/probe.mjs");
  return args;
}
