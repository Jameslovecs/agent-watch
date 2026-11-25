// A free, deterministic agent used to exercise real container boundaries.
import fs from "node:fs";
const emit = (type, message) =>
  console.log(
    JSON.stringify({ type, message, time: new Date().toISOString() }),
  );
fs.mkdirSync("/tmp/home", { recursive: true });
emit("started", "Sandbox probe started. No model API calls.");
emit(
  "read",
  `Workspace entries: ${fs.readdirSync("/workspace").slice(0, 20).join(", ")}`,
);
try {
  fs.writeFileSync(
    "/workspace/agent-watch-probe.txt",
    "Agent Watch sandbox probe\n",
  );
  emit("write", "Workspace write succeeded.");
} catch (e) {
  emit("blocked", `Workspace write blocked: ${e.code}`);
}
try {
  fs.readFileSync("/host/etc/passwd");
  emit("unexpected", "Host path was visible");
} catch {
  emit("blocked", "Host filesystem is not mounted.");
}
let tick = 0;
const t = setInterval(() => {
  emit("progress", `Health check ${++tick}/30`);
  if (tick >= 30) {
    clearInterval(t);
    emit("completed", "Sandbox probe finished.");
  }
}, 1000);
