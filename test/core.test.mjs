import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Store,
  verify,
  redact,
  dockerArgs,
  defaults,
  validatePolicy,
} from "../server/core.mjs";
test("audit survives restart, detects modified entries, and filters known secrets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-unit-"));
  try {
    const s = new Store(dir, ["test-secret-value"]);
    s.event("test", "Value test-secret-value");
    s.event("approved", "operator action");
    assert.equal(verify(s.state.events), true);
    assert.ok(!fs.readFileSync(s.file, "utf8").includes("test-secret-value"));
    assert.equal(new Store(dir).state.events.length, 2);
    s.state.events[0].message = "tampered";
    assert.equal(verify(s.state.events), false);
    s.save();
    assert.throws(() => new Store(dir), /integrity/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("runtime args enforce immutable mount and network boundaries without shell interpolation", () => {
  const task = "$(touch /host/owned)";
  const a = dockerArgs(
    { container: "test", runtime: "codex", task, policy: defaults()[0] },
    "/tmp/project",
    "test-image",
  );
  assert.ok(a.includes("type=bind,src=/tmp/project,dst=/workspace,readonly"));
  assert.equal(a[a.indexOf("--network") + 1], "none");
  assert.ok(a.includes("--cap-drop=ALL"));
  assert.ok(a.includes("--read-only"));
  assert.equal(a.at(-1), task);
  assert.ok(!a.some((x) => x.includes("docker.sock")));
});
test("policy limits and credential patterns", () => {
  assert.throws(() => validatePolicy({ ...defaults()[0], timeout: 0 }));
  assert.throws(() => validatePolicy({ ...defaults()[0], write: "true" }));
  assert.equal(redact("api_key=abc123"), "api_key=[REDACTED]");
  assert.ok(
    !redact("sk-abcdefghijklmnopqrstuvwxyz").includes(
      "abcdefghijklmnopqrstuvwxyz",
    ),
  );
});
