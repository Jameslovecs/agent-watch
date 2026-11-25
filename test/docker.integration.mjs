import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { verify } from "../server/core.mjs";
const exec = promisify(execFile);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-watch-integration-")),
  work = path.join(root, "workspace"),
  data = path.join(root, "data"),
  port = 14319;
fs.mkdirSync(work);
fs.chmodSync(work, 0o777);
fs.writeFileSync(path.join(work, "README.md"), "fixture");
let child, token;
const ownContainers = new Set();
async function api(route, body, method = "POST", headers = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/api${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await r.json();
  if (parsed.container) ownContainers.add(parsed.container);
  return { status: r.status, body: parsed };
}
async function until(fn) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await delay(100);
  }
  throw Error("Timed out waiting for state");
}
const state = async () => (await api("/state", undefined, "GET")).body;
async function start() {
  child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_WATCH_DATA: data,
      AGENT_WATCH_WORKSPACE: work,
      CODEX_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (c) => (errors += c));
  await until(async () => {
    if (child.exitCode !== null) throw Error(errors);
    try {
      return (await fetch(`http://127.0.0.1:${port}/`)).ok;
    } catch {
      return false;
    }
  });
  token = fs.readFileSync(path.join(data, "access-token"), "utf8");
}
async function stop() {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
}
test("real Docker control plane: auth, policy, isolation, approvals, pause, resume, stop, recovery", async () => {
  try {
    await start();
    assert.equal(
      (
        await api("/state", undefined, "GET", {
          Authorization: "Bearer invalid",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await api("/state", undefined, "GET", {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise((resolve) => {
      const r = http.get(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/state",
          headers: { Host: "evil.example", Authorization: `Bearer ${token}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      r.on("error", () => resolve(0));
    });
    assert.equal(hostStatus, 403);
    const observer = (
      await api("/runs", {
        name: "Readonly test",
        runtime: "probe",
        task: "Inspect fixture",
        policyId: "observe",
      })
    ).body;
    assert.equal(observer.status, "running");
    await until(async () =>
      (await state()).events.some(
        (e) =>
          e.runId === observer.id &&
          e.message.includes("Workspace write blocked"),
      ),
    );
    assert.equal(
      fs.existsSync(path.join(work, "agent-watch-probe.txt")),
      false,
    );
    const inspect = JSON.parse(
      (await exec("docker", ["inspect", observer.container])).stdout,
    )[0];
    assert.equal(inspect.HostConfig.NetworkMode, "none");
    assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
    assert.equal(
      inspect.Mounts.find((m) => m.Destination === "/workspace").RW,
      false,
    );
    const net = await exec("docker", [
      "exec",
      observer.container,
      "node",
      "-e",
      "const n=require('net').connect({host:'1.1.1.1',port:443});n.on('connect',()=>process.exit(4));n.on('error',()=>{console.log('network blocked');process.exit(0)});setTimeout(()=>process.exit(0),1500)",
    ]);
    assert.match(net.stdout, /network blocked/);
    assert.equal(
      (await api(`/runs/${observer.id}/pause`, {})).body.status,
      "paused",
    );
    assert.equal(
      JSON.parse(
        (await exec("docker", ["inspect", observer.container])).stdout,
      )[0].State.Paused,
      true,
    );
    assert.equal(
      (await api(`/runs/${observer.id}/resume`, {})).body.status,
      "running",
    );
    assert.equal(
      (await api(`/runs/${observer.id}/stop`, {})).body.status,
      "stopped",
    );
    const pending = (
      await api("/runs", {
        runtime: "probe",
        task: "Write fixture",
        policyId: "build",
      })
    ).body;
    assert.equal(pending.status, "pending");
    await assert.rejects(() => exec("docker", ["inspect", pending.container]));
    const original = pending.policy;
    await api("/policies/build", { ...original, write: false }, "PUT");
    assert.equal(
      (await state()).runs.find((r) => r.id === pending.id).policy.write,
      true,
    );
    assert.equal(
      (await api(`/runs/${pending.id}/approve`, {})).body.status,
      "running",
    );
    assert.equal((await api(`/runs/${pending.id}/approve`, {})).status, 400);
    await until(async () =>
      fs.existsSync(path.join(work, "agent-watch-probe.txt")),
    );
    const denied = (
      await api("/runs", {
        runtime: "probe",
        task: "Deny test",
        policyId: "connected",
      })
    ).body;
    assert.equal(
      (await api(`/runs/${denied.id}/deny`, {})).body.status,
      "denied",
    );
    await assert.rejects(() => exec("docker", ["inspect", denied.container]));
    assert.equal(
      (
        await api("/runs", {
          runtime: "claude",
          task: "Should not call provider",
          policyId: "connected",
        })
      ).status,
      400,
    );
    assert.equal((await api("/stop-all", {})).body.failures.length, 0);
    const audit = (await state()).events;
    assert.equal(verify(audit), true);
    // Unclean shutdown: the next gateway must remove the previously active container.
    const recovery = (
      await api("/runs", {
        runtime: "probe",
        task: "Recovery test",
        policyId: "observe",
      })
    ).body;
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    await start();
    assert.equal(
      (await state()).runs.find((r) => r.id === recovery.id).status,
      "stopped",
    );
    await assert.rejects(() => exec("docker", ["inspect", recovery.container]));
    assert.equal(verify((await state()).events), true);
    // Timeout includes paused time.
    const updated = await api(
      "/policies/observe",
      { ...(await state()).policies[0], timeout: 10 },
      "PUT",
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.timeout, 10);
    const limited = (
      await api("/runs", {
        runtime: "probe",
        task: "Timeout test",
        policyId: "observe",
      })
    ).body;
    assert.equal(limited.policy.timeout, 10);
    await delay(500);
    const pauseResult = await api(`/runs/${limited.id}/pause`, {});
    assert.equal(pauseResult.status, 200);
    await delay(10500);
    await until(
      async () =>
        (await state()).runs.find((r) => r.id === limited.id).status ===
        "stopped",
    );
    assert.equal(
      (await state()).runs.find((r) => r.id === limited.id).status,
      "stopped",
    );
    await stop();
    console.log(
      "Verified real read-only mounts, no-network boundary, pause/resume/stop, approvals, restart recovery, timeout, and audit chain.",
    );
  } finally {
    await stop().catch(() => {});
    for (const name of ownContainers) {
      if (name) await exec("docker", ["rm", "-f", name]).catch(() => {});
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
