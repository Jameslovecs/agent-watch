const key = "agent-watch-demo-v1";
const policies = [
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
export function seed() {
  const now = Date.now(),
    ago = (n) => new Date(now - n * 1000).toISOString();
  const runs = [
    {
      id: "demo-1",
      name: "Checkout refactor",
      runtime: "codex",
      task: "Refactor the checkout flow and run the unit tests.",
      policy: { ...policies[2] },
      status: "running",
      createdAt: ago(244),
      startedAt: ago(240),
    },
    {
      id: "demo-2",
      name: "API security review",
      runtime: "claude",
      task: "Review API routes for unsafe input handling and summarize findings.",
      policy: { ...policies[0] },
      status: "running",
      createdAt: ago(132),
      startedAt: ago(130),
    },
    {
      id: "demo-3",
      name: "Dependency update",
      runtime: "codex",
      task: "Update the payment SDK and run regression tests.",
      policy: { ...policies[2] },
      status: "pending",
      createdAt: ago(82),
    },
    {
      id: "demo-4",
      name: "Documentation refresh",
      runtime: "claude",
      task: "Update setup documentation for the new API.",
      policy: { ...policies[1] },
      status: "pending",
      createdAt: ago(46),
    },
    {
      id: "demo-5",
      name: "Sandbox boundary check",
      runtime: "probe",
      task: "Verify workspace and host isolation.",
      policy: { ...policies[0] },
      status: "completed",
      createdAt: ago(360),
      endedAt: ago(330),
    },
  ];
  const events = [
    {
      type: "requested",
      message: "Security review requested.",
      runId: "demo-2",
      time: ago(132),
    },
    {
      type: "started",
      message: "Isolated workspace mounted read-only.",
      runId: "demo-2",
      time: ago(130),
    },
    {
      type: "output",
      message: "Reading src/api/checkout.ts and tracing request validation.",
      runId: "demo-2",
      time: ago(115),
    },
    {
      type: "output",
      message: "Running checkout unit tests in the workspace.",
      runId: "demo-1",
      time: ago(90),
    },
    {
      type: "approval",
      message: "Approval required: workspace writes and outbound network.",
      runId: "demo-3",
      time: ago(82),
    },
    {
      type: "output",
      message:
        "Workspace write blocked: EROFS. Host filesystem is not mounted.",
      runId: "demo-5",
      time: ago(60),
    },
    {
      type: "approval",
      message: "Approval required: workspace writes.",
      runId: "demo-4",
      time: ago(46),
    },
  ].map((e, i) => ({ ...e, id: `event-${i}`, details: {} }));
  return {
    mode: "demo",
    workspace: "/workspace/acme-store",
    policies,
    runs,
    events,
    runtimes: { probe: true, codex: true, claude: true },
    integrity: null,
  };
}
export class Demo {
  constructor() {
    try {
      this.data = JSON.parse(localStorage.getItem(key)) || seed();
    } catch {
      this.data = seed();
    }
    this.save();
  }
  save() {
    try {
      localStorage.setItem(key, JSON.stringify(this.data));
    } catch {}
  }
  event(type, message, runId = null, details = {}) {
    this.data.events.push({
      id: crypto.randomUUID(),
      type,
      message,
      runId,
      details,
      time: new Date().toISOString(),
    });
    this.save();
  }
  async state() {
    return structuredClone(this.data);
  }
  async action(route, body = {}, method = "POST") {
    if (route === "/stop-all") {
      for (const r of this.data.runs) {
        if (["running", "paused", "pending"].includes(r.status)) {
          r.status = r.status === "pending" ? "denied" : "stopped";
          this.event(r.status, "Emergency stop requested by operator.", r.id);
        }
      }
      return { failures: [] };
    }
    if (route === "/runs") {
      const policy = this.data.policies.find((p) => p.id === body.policyId),
        r = {
          id: crypto.randomUUID(),
          name: body.name || "New agent run",
          runtime: body.runtime,
          task: body.task,
          policy: structuredClone(policy),
          status: policy.write || policy.network ? "pending" : "running",
          createdAt: new Date().toISOString(),
        };
      this.data.runs.unshift(r);
      this.event(
        r.status === "pending" ? "approval" : "started",
        r.status === "pending"
          ? "Run is waiting for operator approval."
          : "Simulated run started.",
        r.id,
        { policy },
      );
      return r;
    }
    if (route.startsWith("/policies/")) {
      const id = route.split("/").at(-1),
        i = this.data.policies.findIndex((p) => p.id === id);
      this.data.policies[i] = { ...body, id };
      this.event("policy", "Policy updated for future runs.", null, {
        policy: this.data.policies[i],
      });
      return;
    }
    const [, , id, action] = route.split("/"),
      run = this.data.runs.find((r) => r.id === id);
    if (!run) throw Error("Run not found.");
    const transitions = {
      approve: ["pending", "running"],
      deny: ["pending", "denied"],
      pause: ["running", "paused"],
      resume: ["paused", "running"],
    };
    if (action === "stop") {
      if (!["running", "paused"].includes(run.status))
        throw Error("Run is no longer active.");
      run.status = "stopped";
    } else {
      const t = transitions[action];
      if (!t || run.status !== t[0]) throw Error("Action no longer available.");
      run.status = t[1];
    }
    this.event(
      action,
      {
        approve: "Operator approved this run and its exact policy.",
        deny: "Operator denied this run.",
        pause: "Container paused by operator.",
        resume: "Container resumed by operator.",
        stop: "Container stopped by operator.",
      }[action],
      run.id,
    );
    this.save();
    return run;
  }
  reset() {
    this.data = seed();
    this.save();
  }
  tick() {
    const run = this.data.runs.find((r) => r.status === "running");
    if (!run) return;
    const lines = [
      "Inspecting workspace files and validating task context.",
      "Checking changes against the acceptance criteria.",
      "Running focused checks inside the sandbox.",
    ];
    this.event(
      "output",
      lines[Math.floor(Math.random() * lines.length)],
      run.id,
    );
    if (this.data.events.length > 500)
      this.data.events = this.data.events.slice(-500);
    this.save();
  }
}
