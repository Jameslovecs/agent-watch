import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store, redact, verify, validatePolicy, dockerArgs } from "./core.mjs";
const exec = promisify(execFile),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(
  process.env.AGENT_WATCH_DATA || path.join(root, ".agent-watch"),
);
const workspace = fs.realpathSync(
  process.env.AGENT_WATCH_WORKSPACE || path.join(root, "sandbox-workspace"),
);
if (workspace.includes(",") || !fs.statSync(workspace).isDirectory())
  throw Error("Workspace must be a directory with no comma in its path.");
const secrets = [
  process.env.CODEX_API_KEY,
  process.env.ANTHROPIC_API_KEY,
].filter(Boolean);
const store = new Store(dir, secrets),
  state = store.state;
const tokenFile = path.join(dir, "access-token");
const token = fs.existsSync(tokenFile)
  ? fs.readFileSync(tokenFile, "utf8").trim()
  : randomBytes(32).toString("hex");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const port = Number(process.env.PORT || 4310),
  image = process.env.AGENT_WATCH_IMAGE || "agent-watch-runner:1";
const timers = new Map(),
  children = new Map();
let shuttingDown = false;
const docker = (args) =>
  exec("docker", args, { timeout: 20000, maxBuffer: 1024 * 1024 });
const active = (r) =>
  ["running", "paused", "starting", "stopping"].includes(r.status);
// Fail closed after an unclean server exit: never silently adopt unmanaged work.
for (const run of state.runs.filter(active)) {
  try {
    await docker(["rm", "-f", run.container]);
    run.status = "stopped";
    store.event("recovery", "Stopped container after gateway restart.", run.id);
  } catch (e) {
    if (!e.stderr?.includes("No such container"))
      throw Error(
        "Cannot reconcile containers. Start Docker and restart the gateway.",
      );
    run.status = "interrupted";
    store.event("recovery", "Run interrupted before gateway restart.", run.id);
  }
}
function finish(run, status, message) {
  if (!active(run)) return;
  run.status = status;
  run.endedAt = new Date().toISOString();
  clearTimeout(timers.get(run.id));
  timers.delete(run.id);
  store.event(status, message, run.id);
}
async function launch(run) {
  run.status = "starting";
  store.event("starting", "Creating isolated container.", run.id, {
    policy: run.policy,
  });
  try {
    await docker(dockerArgs(run, workspace, image));
    await docker(["start", run.container]);
    run.status = "running";
    run.startedAt = new Date().toISOString();
    store.event("started", "Container started.", run.id);
    const child = spawn("docker", ["logs", "--follow", run.container], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.set(run.id, child);
    const streams = new Map();
    let outputCount = 0;
    const record = (line) => {
      if (!line.trim() || outputCount++ >= 3000) return;
      store.event("output", redact(line.slice(0, 12000), secrets), run.id);
    };
    const consume = (key, chunk) => {
      let buffer = (streams.get(key) || "") + chunk.toString();
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        record(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
      if (buffer.length > 12000) {
        record(buffer.slice(0, 12000));
        buffer = "";
      }
      streams.set(key, buffer);
    };
    child.stdout.on("data", (c) => consume("out", c));
    child.stderr.on("data", (c) => consume("err", c));
    child.on("error", (e) => finish(run, "failed", redact(e.message, secrets)));
    child.on("close", async (code) => {
      for (const s of streams.values()) record(s);
      if (run.status !== "stopping" && active(run)) {
        try {
          const result = await docker([
            "inspect",
            "--format",
            "{{.State.ExitCode}}",
            run.container,
          ]);
          code = Number(result.stdout.trim());
        } catch {
          code = 1;
        }
        if (run.status !== "stopping")
          finish(
            run,
            code === 0 ? "completed" : "failed",
            `Container exited with code ${code}.`,
          );
      }
      children.delete(run.id);
      if (run.status !== "stopping")
        await docker(["rm", "-f", run.container]).catch(() => {});
    });
    timers.set(
      run.id,
      setTimeout(() => {
        queueMutation(() =>
          control(run, "stop", "Runtime limit reached."),
        ).catch(() => {});
      }, run.policy.timeout * 1000),
    );
  } catch (e) {
    finish(
      run,
      "failed",
      redact(e.stderr || e.message, secrets).slice(0, 2000),
    );
    await docker(["rm", "-f", run.container]).catch(() => {});
  }
}
async function control(run, action, reason = "Operator intervention.") {
  if (action === "pause" && run.status === "running") {
    await docker(["pause", run.container]);
    run.status = "paused";
    store.event("paused", reason, run.id);
  } else if (action === "resume" && run.status === "paused") {
    await docker(["unpause", run.container]);
    run.status = "running";
    store.event("resumed", reason, run.id);
  } else if (action === "stop" && active(run)) {
    // Force removal kills paused containers as well; do not mark stopped before Docker confirms it.
    const previous = run.status;
    run.status = "stopping";
    store.save();
    try {
      await docker(["rm", "-f", run.container]);
      finish(run, "stopped", reason);
    } catch (e) {
      run.status = previous;
      store.save();
      throw e;
    }
  } else throw Error("Action is not valid for the current run state.");
}
let mutation = Promise.resolve();
function queueMutation(fn) {
  const result = mutation.then(fn);
  mutation = result.catch(() => {});
  return result;
}
const publicState = () => ({
  ...state,
  mode: "local",
  workspace,
  integrity: verify(state.events),
  runtimes: {
    probe: true,
    codex: !!process.env.CODEX_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
  },
});
async function api(req, url, body) {
  if (req.method === "GET" && url.pathname === "/api/state")
    return publicState();
  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      await docker(["image", "inspect", image]);
      return { ready: true, image };
    } catch {
      return {
        ready: false,
        image,
        message: "Start Docker and run npm run image.",
      };
    }
  }
  if (req.method === "POST" && url.pathname === "/api/runs") {
    if (shuttingDown) throw Error("Gateway is shutting down.");
    if (
      state.runs.filter((r) => active(r) || r.status === "pending").length >= 12
    )
      throw Error("Maximum 12 active or pending runs.");
    if (!["probe", "codex", "claude"].includes(body.runtime))
      throw Error("Unknown runtime.");
    if (
      typeof body.task !== "string" ||
      body.task.trim().length < 1 ||
      body.task.length > 8000
    )
      throw Error("Task must contain 1–8000 characters.");
    const policy = state.policies.find((p) => p.id === body.policyId);
    if (!policy) throw Error("Unknown policy.");
    if (body.runtime !== "probe") {
      if (!policy.network)
        throw Error("Codex and Claude require a network-enabled policy.");
      if (!publicState().runtimes[body.runtime])
        throw Error("Runtime credentials are not configured. See Setup.");
    }
    const run = {
      id: randomUUID(),
      name: String(body.name || `${body.runtime} run`).slice(0, 60),
      runtime: body.runtime,
      task: redact(body.task, secrets),
      policy: structuredClone(policy),
      status: policy.write || policy.network ? "pending" : "starting",
      createdAt: new Date().toISOString(),
    };
    run.container = `agent-watch-${run.id}`;
    state.runs.unshift(run);
    store.event("requested", "Run requested.", run.id, {
      policy: run.policy,
      task: run.task,
    });
    if (run.status === "pending")
      store.event(
        "approval",
        "Run requires approval before workspace writes or network access.",
        run.id,
      );
    else await launch(run);
    return run;
  }
  const match = url.pathname.match(
    /^\/api\/runs\/([\w-]+)\/(approve|deny|pause|resume|stop)$/,
  );
  if (req.method === "POST" && match) {
    const run = state.runs.find((r) => r.id === match[1]);
    if (!run) throw Error("Run not found.");
    const action = match[2];
    if (["approve", "deny"].includes(action)) {
      if (run.status !== "pending")
        throw Error("This request has already been resolved.");
      store.event(
        action === "approve" ? "approved" : "denied",
        action === "approve"
          ? "Operator approved the exact run policy."
          : "Operator denied the run.",
        run.id,
        { policy: run.policy },
      );
      if (action === "approve") await launch(run);
      else {
        run.status = "denied";
        store.save();
      }
    } else await control(run, action);
    return run;
  }
  if (req.method === "PUT" && url.pathname.startsWith("/api/policies/")) {
    const id = url.pathname.split("/").at(-1),
      index = state.policies.findIndex((p) => p.id === id);
    if (index < 0) throw Error("Unknown policy.");
    const policy = validatePolicy({ ...body, id });
    state.policies[index] = policy;
    store.event(
      "policy",
      "Policy updated for future runs. Existing runs retain their snapshot.",
      null,
      { policy },
    );
    return policy;
  }
  if (req.method === "POST" && url.pathname === "/api/stop-all") {
    const failures = [];
    for (const run of state.runs) {
      if (run.status === "pending") {
        run.status = "denied";
        store.event("denied", "Cancelled by emergency stop.", run.id);
      } else if (active(run)) {
        try {
          await control(run, "stop", "Emergency stop.");
        } catch (e) {
          failures.push(run.id);
          store.event(
            "error",
            "Could not stop container. Check Docker immediately.",
            run.id,
          );
        }
      }
    }
    return { failures };
  }
  throw Error("Unknown API operation.");
}
const server = http.createServer(async (req, res) => {
  const send = (code, value) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (
      req.headers.host !== `127.0.0.1:${port}` &&
      req.headers.host !== `localhost:${port}`
    )
      return send(403, { error: "Invalid Host." });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`)
      return send(403, { error: "Cross-origin requests are blocked." });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (url.pathname.startsWith("/api/")) {
      const supplied = Buffer.from(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      const expected = Buffer.from(token);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return send(401, {
          error:
            "Enter the gateway access token from your local .agent-watch/access-token file.",
        });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 20000)
          return send(413, { error: "Request too large." });
      }
      const body = raw ? JSON.parse(raw) : {};
      const result =
        req.method === "GET"
          ? await api(req, url, body)
          : await queueMutation(() => api(req, url, body));
      return send(200, result);
    }
    const files = {
      "/": "index.html",
      "/index.html": "index.html",
      "/app.js": "app.js",
      "/demo.js": "demo.js",
      "/style.css": "style.css",
      "/favicon.svg": "favicon.svg",
    };
    const file = files[url.pathname];
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      }[ext],
      "Cache-Control": "no-cache",
    });
    res.end(fs.readFileSync(path.join(root, "web", file)));
  } catch (e) {
    send(400, { error: redact(e.message, secrets) });
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(
    `Agent Watch: http://127.0.0.1:${port}/?local=1\nAccess token file: ${tokenFile}\nWorkspace: ${workspace}\nNo model calls are made until you configure credentials and approve a run.`,
  );
});
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await queueMutation(async () => {
    for (const r of state.runs.filter(active)) {
      try {
        await control(r, "stop", "Gateway shutdown.");
      } catch {
        store.event(
          "error",
          "Shutdown could not stop container. Restart gateway to reconcile.",
          r.id,
        );
      }
    }
  });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
