import { Demo } from "./demo.js";
const local = new URLSearchParams(location.search).has("local");
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal");
let token = sessionStorage.getItem("agent-watch-token") || "",
  data,
  view = "overview",
  selected,
  query = "",
  filter = "all",
  busy = false,
  offline = false,
  health = null;
const demo = new Demo();
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  agents:
    "M8 5h8a4 4 0 0 1 4 4v10H4V9a4 4 0 0 1 4-4Z M12 2v3 M8 10h.01 M16 10h.01 M8 15h8",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z m-4 9 3 3 5-6",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14 M5 12h14",
  pause: "M8 5v14 M16 5v14",
  play: "m7 4 14 8-14 8Z",
  stop: "M5 5h14v14H5z",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  external: "M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7",
  close: "m6 6 12 12 M18 6 6 18",
  alert: "m12 3 10 18H2Z M12 9v5 M12 17h.01",
  terminal: "m4 6 6 6-6 6 M13 18h7",
  file: "M14 2H5v20h14V7Z M14 2v6h5 M8 12h8 M8 16h6",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4",
  refresh: "M20 7a9 9 0 1 0 1 8 M20 2v6h-6",
};
const icon = (n) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[n] || paths.activity}"/></svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const title = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const runtimeName = (r) =>
  r === "probe" ? "Sandbox probe" : r === "claude" ? "Claude Code" : "Codex";
const runtimeIcon = (r) =>
  `<span class="runtime-icon ${esc(r)}">${r === "claude" ? "✳" : r === "codex" ? "⌘" : icon("terminal")}</span>`;
const badge = (s) =>
  `<span class="pill ${esc(s)}">${s === "running" ? '<span class="dot"></span>' : ""}${s === "pending" ? "Needs approval" : esc(title(s))}</span>`;
const time = (t) =>
  new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const duration = (r) => {
  const n = Math.max(
    0,
    Math.floor(
      ((r.endedAt ? new Date(r.endedAt) : Date.now()) - new Date(r.createdAt)) /
        1000,
    ),
  );
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`;
};
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 4000);
}
async function request(route, body, method = "POST") {
  if (!local) return demo.action(route, body, method);
  const r = await fetch(`/api${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Gateway request failed.");
  return result;
}
async function refresh(renderPage = true) {
  try {
    data = local
      ? await request("/state", undefined, "GET")
      : await demo.state();
    offline = false;
    if (!selected || !data.runs.some((r) => r.id === selected))
      selected = data.runs[0]?.id;
    if (renderPage) render();
  } catch (e) {
    offline = true;
    if (!data) renderLogin(e.message);
    else if (renderPage) render();
  }
}
function renderLogin(error = "") {
  app.innerHTML = `<main class="login panel prose"><div class="eyebrow">Agent Watch · Local gateway</div><h1>Connect your control room</h1><p>Enter the access token stored on this machine. The gateway only accepts same-origin, authenticated requests.</p><pre>cat .agent-watch/access-token</pre><form id="login"><label class="field">Access token<input name="token" type="password" autocomplete="off" required placeholder="Paste your local access token"></label><p class="error">${esc(error)}</p><button class="primary">Connect gateway</button></form><p><a href="?">Explore the demo instead</a></p></main>`;
  document.querySelector("#login").onsubmit = async (e) => {
    e.preventDefault();
    token = new FormData(e.target).get("token");
    sessionStorage.setItem("agent-watch-token", token);
    await refresh();
  };
}
const navs = [
  ["overview", "grid", "Overview"],
  ["agents", "agents", "Agents"],
  ["approvals", "shield", "Approvals"],
  ["policies", "settings", "Access policies"],
  ["audit", "activity", "Audit log"],
  ["setup", "terminal", "Setup & docs"],
];
function render() {
  if (!data) return;
  const pending = data.runs.filter((r) => r.status === "pending").length;
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="./favicon.svg" alt="">agent watch<span class="secondary">/</span></div><div class="workspace">Control room</div><nav class="nav" aria-label="Main navigation">${navs.map(([id, i, name]) => `<button data-nav="${id}" class="${view === id ? "active" : ""}" ${view === id ? 'aria-current="page"' : ""}>${icon(i)}${name}${id === "approvals" && pending ? `<span class="count">${pending}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="sidebar-note">${icon("shield")}<strong>Your agents. Your boundaries.</strong>Visibility and control, from first action to final output.<br><a href="https://github.com/Jameslovecs/agent-watch" target="_blank" rel="noopener">View on GitHub</a></div><div class="profile"><span class="avatar">${local ? "L" : "D"}</span><div>${local ? "Local workspace" : "Demo workspace"}<small>${local ? "Private · this machine" : "Public sandbox · no API calls"}</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumb">Workspace <span>/</span> <strong>${navs.find((n) => n[0] === view)?.[2]}</strong></div><div class="top-actions"><span class="connection"><span class="dot"></span>${offline ? "Gateway disconnected" : local ? "Gateway connected" : "Interactive demo"}</span><button data-action="export">${icon("download")}Export audit</button></div></header><div class="content">${offline ? '<div class="banner error">Gateway disconnected. Displaying the last received state; controls may fail. Check the local server.</div>' : ""}${page()}<footer class="footer"><span>AGENT WATCH <span aria-hidden="true">/</span> Open-source agent control</span><span>${local ? "Loopback only · authenticated" : "Demo data stays in your browser"} · <a href="https://github.com/Jameslovecs/agent-watch" target="_blank" rel="noopener">GitHub</a></span></footer></div></main></div>`;
  bind();
}
function heading(titleText, subtitle, buttons = "") {
  return `<div class="page-heading"><div><div class="eyebrow">Agent operations</div><h1>${titleText}</h1><p>${subtitle}</p></div><div class="actions">${buttons}</div></div>`;
}
const startButton = () =>
  `<button class="primary" data-action="launch">${icon("plus")}Launch agent</button>`;
const demoBanner = () =>
  local
    ? ""
    : `<div class="banner">${icon("terminal")}<span><b>You’re in the demo workspace.</b> Try an approval, pause an agent, or change a policy. No real agents are connected.</span><button data-nav="setup">Connect your agents</button></div>`;
function page() {
  if (view === "overview" || view === "agents") return overview();
  if (view === "approvals") return approvals();
  if (view === "policies") return policies();
  if (view === "audit") return audit();
  return setup();
}
function overview() {
  const running = data.runs.filter((r) => r.status === "running").length,
    pending = data.runs.filter((r) => r.status === "pending").length,
    paused = data.runs.filter((r) => r.status === "paused").length;
  return (
    heading(
      view === "agents" ? "Your agent fleet" : "A clear view. A firm hand.",
      "Know what your agents are doing. Decide what happens next.",
      `<button class="danger" data-action="emergency">${icon("stop")}Stop all</button>${startButton()}`,
    ) +
    demoBanner() +
    `<div class="stats">${[
      ["Running agents", running, "Across your connected runtimes", "agents"],
      [
        "Awaiting approval",
        pending,
        pending ? "Your attention is needed" : "All requests reviewed",
        "shield",
      ],
      ["Paused agents", paused, "Ready when you are", "pause"],
      [
        "Recorded events",
        data.events.length,
        local
          ? "Hash-linked audit trail"
          : "Simulated activity in this browser",
        "activity",
      ],
    ]
      .map(
        ([label, value, foot, i], n) =>
          `<div class="stat ${n === 1 && pending ? "warning" : ""}"><div class="stat-top">${label}${icon(i)}</div><div class="stat-value">${value.toString().padStart(2, "0")}</div><div class="stat-foot">${foot}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><div><section class="panel"><div class="panel-head"><h2>Agent fleet <span class="badge-outline">${data.runs.length} runs</span></h2><small>Select a run to inspect</small></div><div class="toolbar"><div class="search">${icon("search")}<input id="search" aria-label="Search agents" placeholder="Search agents or tasks…" value="${esc(query)}"></div><select id="filter" aria-label="Filter by status">${["all", "running", "pending", "paused", "completed", "failed", "stopped", "denied"].map((s) => `<option value="${s}" ${filter === s ? "selected" : ""}>${s === "all" ? "All statuses" : title(s)}</option>`).join("")}</select></div><div id="fleet">${fleet()}</div></section><section class="panel activity-panel"><div class="panel-head"><h2>Activity stream</h2><button class="icon-button" data-nav="audit">View all</button></div>${events(data.events.slice(-5).reverse())}</section></div><div class="detail-column"><section class="panel">${detail()}</section>${pending ? `<section class="attention"><h2>${icon("alert")}A decision is waiting</h2><p>${pending} ${pending === 1 ? "run needs" : "runs need"} your approval before receiving broader access.</p><button data-nav="approvals">Review requests</button></section>` : `<section class="attention"><h2>${icon("check")}You’re all caught up</h2><p>No pending access requests. Your policies are holding the boundary.</p><button data-nav="policies">Review policies</button></section>`}</div></div>`
  );
}
function fleet() {
  const runs = data.runs.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      `${r.name} ${r.task} ${r.runtime}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!runs.length)
    return `<div class="empty">${icon("agents")}<h2>${data.runs.length ? "No matching agents" : "Your control room is ready"}</h2><p>${data.runs.length ? "Try another search or status." : "Launch the free sandbox probe to verify your setup."}</p>${data.runs.length ? "" : startButton()}</div>`;
  return `<div class="table-scroll"><table><thead><tr><th>Agent / task</th><th>Status</th><th>Policy</th><th>Elapsed</th></tr></thead><tbody>${runs.map((r) => `<tr data-run="${esc(r.id)}" class="${selected === r.id ? "selected" : ""}" tabindex="0" aria-label="Inspect ${esc(r.name)}"><td><div class="agent">${runtimeIcon(r.runtime)}<div><div class="agent-name">${esc(r.name)}</div><div class="secondary">${runtimeName(r.runtime)}</div></div></div></td><td>${badge(r.status)}</td><td class="secondary">${esc(r.policy.name)}</td><td class="mono secondary">${duration(r)}</td></tr>`).join("")}</tbody></table></div><div class="table-footer"><span>${runs.length} of ${data.runs.length} runs</span><span>${local ? "Refreshes every 3s" : "Simulated workspace"}</span></div>`;
}
function permissionList(p) {
  return `<div class="permissions"><div class="permission"><span>Workspace access</span><strong>${p.write ? "Read & write" : "Read only"}</strong></div><div class="permission"><span>Outbound network</span><strong>${p.network ? "Unrestricted" : "Blocked"}</strong></div><div class="permission"><span>Runtime limit</span><strong>${p.timeout}s</strong></div></div>`;
}
function runButtons(r) {
  return `<div class="actions">${r.status === "pending" ? `<button data-run-action="deny" data-id="${r.id}">Deny</button><button class="primary" data-run-action="approve" data-id="${r.id}">Approve run</button>` : r.status === "running" ? `<button data-run-action="pause" data-id="${r.id}">${icon("pause")}Pause</button><button class="danger" data-run-action="stop" data-id="${r.id}">${icon("stop")}Stop</button>` : r.status === "paused" ? `<button class="primary" data-run-action="resume" data-id="${r.id}">${icon("play")}Resume</button><button class="danger" data-run-action="stop" data-id="${r.id}">${icon("stop")}Stop</button>` : `<span class="secondary">This run has ended.</span>`}</div>`;
}
function detail() {
  const r = data.runs.find((r) => r.id === selected);
  if (!r)
    return `<div class="empty">${icon("shield")}<h2>No agent selected</h2><p>Launch a run to inspect its permissions and activity.</p></div>`;
  return `<div class="panel-head"><h2>Run inspector</h2>${badge(r.status)}</div><div class="detail"><div class="agent">${runtimeIcon(r.runtime)}<div><div class="agent-name">${esc(r.name)}</div><div class="secondary">${runtimeName(r.runtime)}</div></div></div><div class="detail-task">${esc(r.task)}</div><span class="label">Workspace boundary</span><div class="path mono">${esc(data.workspace)}</div>${permissionList(r.policy)}<span class="label">${esc(r.policy.name)} · policy snapshot</span>${runButtons(r)}<p class="micro-note">${r.status === "pending" ? "Approval grants this run the permissions shown above, for its full lifetime." : "Pause freezes the container. Stop terminates it; completed writes are not reversed."}</p><button data-action="run-audit" data-id="${r.id}">${icon("activity")}Inspect audit trail</button></div>`;
}
function events(list) {
  return list.length
    ? `<div class="event-list">${list.map((e) => `<div class="event"><div class="event-icon">${icon(["approval", "denied", "error"].includes(e.type) ? "alert" : e.type === "output" ? "terminal" : "shield")}</div><div><div class="event-message">${esc(e.message)}</div><div class="event-meta">${esc(data.runs.find((r) => r.id === e.runId)?.name || "Workspace")} · ${esc(e.type)}${e.hash ? ` · ${esc(e.hash.slice(0, 10))}` : ""}</div></div><time class="event-time" datetime="${esc(e.time)}">${time(e.time)}</time></div>`).join("")}</div>`
    : `<div class="empty">${icon("activity")}<h2>No events yet</h2><p>Activity will appear as agents run.</p></div>`;
}
function approvals() {
  const pending = data.runs.filter((r) => r.status === "pending");
  return (
    heading(
      "The decision stays with you.",
      "Review the exact task and permissions before a run can start.",
    ) +
    demoBanner() +
    (!pending.length
      ? `<section class="panel empty">${icon("check")}<h2>No approvals waiting</h2><p>Requests for workspace writes or network access will appear here.</p>${startButton()}</section>`
      : pending
          .map(
            (r) =>
              `<section class="panel approval-card"><div class="top"><div class="agent">${runtimeIcon(r.runtime)}<div><h2>${esc(r.name)}</h2><p>${runtimeName(r.runtime)} · Requested ${time(r.createdAt)}</p></div></div>${badge(r.status)}</div><p>${esc(r.task)}</p><div class="path mono">${esc(data.workspace)}</div>${permissionList(r.policy)}${r.policy.network ? '<div class="callout">This policy allows unrestricted outbound network access, including access to services reachable from the container. The agent can transmit workspace contents. Approve only for a trusted task and workspace.</div>' : ""}<p class="micro-note">This approves the whole run, not individual tool calls. The displayed policy snapshot cannot be changed after launch.</p>${runButtons(r)}</section>`,
          )
          .join(""))
  );
}
function policies() {
  return (
    heading(
      "Give every agent a boundary.",
      "Policies are enforced by Docker. Changes apply to future runs only.",
    ) +
    demoBanner() +
    `<div class="cards">${data.policies.map((p) => `<section class="panel policy-card">${icon("shield")}<h2>${esc(p.name)}</h2><p>${esc(p.description)}</p>${permissionList(p)}<button data-policy="${p.id}">${icon("settings")}Edit policy</button></section>`).join("")}</div><div class="callout">Each run receives one mounted workspace, a read-only container filesystem, no host home directory or Docker socket, and CPU, memory, process, and time limits. Network access is either blocked or unrestricted. Per-domain and per-tool restrictions are not part of this version.</div>`
  );
}
let auditRun = "all",
  auditQuery = "";
function audit() {
  const list = data.events
    .filter(
      (e) =>
        (auditRun === "all" || e.runId === auditRun) &&
        `${e.message} ${e.type}`
          .toLowerCase()
          .includes(auditQuery.toLowerCase()),
    )
    .reverse();
  return (
    heading(
      "Every action leaves a trail.",
      "Review activity, policy decisions, and operator interventions.",
      `<button data-action="export">${icon("download")}Download JSON</button>`,
    ) +
    demoBanner() +
    `<section class="panel"><div class="panel-head"><h2>Audit trail</h2><span class="pill">${local ? (data.integrity ? "Hash chain verified" : "Integrity check failed") : "Demo · unhashed sample events"}</span></div><div class="toolbar audit-toolbar"><div class="search">${icon("search")}<input id="audit-search" aria-label="Search audit events" value="${esc(auditQuery)}" placeholder="Search events…"></div><select id="audit-filter" aria-label="Filter audit by run"><option value="all">All agents</option>${data.runs.map((r) => `<option value="${r.id}" ${auditRun === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div><div id="audit-events">${events(list)}</div></section><p class="micro-note">${local ? "Hashes detect edits within the retained chain. Export and store a trusted checkpoint elsewhere to detect truncation or a full rewrite. Secret filtering is best effort; keep exports private." : "Demo events are illustrative. The local gateway stores persistent, hash-linked audit records with best-effort secret redaction."}</p>`
  );
}
function setup() {
  return (
    heading(
      "From demo to your machine.",
      "Run the control plane locally. Keep agent activity under your control.",
    ) +
    `<div class="setup-grid"><section class="panel prose"><h2>Start with the free sandbox probe</h2><p>Node.js 22+ and Docker are required. No model key, account connection, or paid service is needed for the probe.</p><pre>git clone https://github.com/Jameslovecs/agent-watch.git
cd agent-watch
npm run image
npm start</pre><p>Open <a href="http://127.0.0.1:4310/?local=1">your local dashboard</a> and paste the token from <code>.agent-watch/access-token</code>. Launch a Sandbox probe with the Observer policy, then try pause and stop.</p>${local ? `<button data-action="health">${icon("refresh")}Check Docker readiness</button>${health ? `<p class="health ${health.ready ? "ok" : "bad"}">${esc(health.ready ? "Docker image is ready. You can launch the sandbox probe." : health.message)}</p>` : ""}` : ""}<h3>Connect Codex or Claude</h3><p>Configure a provider API key in the gateway process environment and restart. Select a network-enabled policy, review its scope, then approve the run. Provider usage may incur charges; the app never purchases credits or enables billing.</p><pre># Enter the key privately in your shell; do not save it in Git.
# Codex uses CODEX_API_KEY
# Claude uses ANTHROPIC_API_KEY
AGENT_WATCH_WORKSPACE=/path/to/checkout npm start</pre><p><a href="https://github.com/Jameslovecs/agent-watch#connect-codex-or-claude" target="_blank" rel="noopener">Read full setup instructions</a></p></section><section class="panel prose"><h2>What is actually enforced?</h2><ul><li>Only the configured workspace is mounted into the agent container.</li><li>Observer mounts it read-only; builder policies allow changes.</li><li>Network can be fully blocked or unrestricted.</li><li>Write or network-enabled runs wait for explicit approval.</li><li>Pause freezes processes. Stop kills the container.</li><li>Every run has a wall-clock timeout, including paused time.</li></ul><h3>Know the limits</h3><p>Only agents launched here are managed. The app does not discover existing Codex or Claude chats. Approval is for the whole run; individual tool calls are observable only when the runtime emits them. Secrets inside the workspace are readable by that run.</p><p>There is no automatic rollback, domain allowlist, multi-user access, or live prompt steering in this release. Stop a run and launch a corrected task to intervene.</p><h3>Your workspace stays private</h3><p>The public demo stores simulated activity in your browser. Your local gateway binds to loopback, requires a token, and blocks cross-origin requests.</p><div class="actions">${!local ? '<button data-action="reset">Reset demo workspace</button>' : '<button data-action="logout">Disconnect dashboard</button>'}</div></section></div>`
  );
}
function showModal(titleText, content) {
  modal.innerHTML = `<div class="modal-head"><h2>${titleText}</h2><button aria-label="Close dialog" class="icon-button" data-close>${icon("close")}</button></div><div class="form-body">${content}</div>`;
  modal.querySelector("[data-close]").onclick = () => modal.close();
  modal.showModal();
}
function launchModal() {
  showModal(
    "Launch an agent",
    `<form id="launch-form"><div class="field"><label for="run-name">Run name</label><input id="run-name" name="name" required maxlength="60" placeholder="e.g. Review checkout security"></div><div class="field"><label for="runtime">Runtime</label><select id="runtime" name="runtime">${["probe", "codex", "claude"].map((r) => `<option value="${r}" ${local && !data.runtimes[r] ? "disabled" : ""}>${runtimeName(r)}${local && !data.runtimes[r] ? " — key not configured" : ""}</option>`).join("")}</select><small>${local ? "Sandbox probe is free and makes no model calls." : "All runtimes are simulated in this public demo."}</small></div><div class="field"><label for="task">Task</label><textarea id="task" name="task" required maxlength="8000" placeholder="Describe the work and what success looks like…"></textarea></div><div class="field"><label for="policy">Access policy</label><select id="policy" name="policyId">${data.policies.map((p) => `<option value="${p.id}">${esc(p.name)} · ${p.write ? "read/write" : "read only"} · ${p.network ? "network on" : "network off"}</option>`).join("")}</select><small>Write or network access requires approval before execution. Codex and Claude require network access.</small></div><div class="error" id="form-error" role="alert"></div><div class="form-actions"><button type="button" data-cancel>Cancel</button><button class="primary">Create run</button></div></form>`,
  );
  modal.querySelector("[data-cancel]").onclick = () => modal.close();
  modal.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    try {
      const r = await request(
        "/runs",
        Object.fromEntries(new FormData(e.target)),
      );
      selected = r.id;
      view = r.status === "pending" ? "approvals" : "agents";
      modal.close();
      await refresh();
      toast(
        r.status === "pending" ? "Run queued for approval." : "Run created.",
      );
    } catch (err) {
      modal.querySelector("#form-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
function editPolicy(id) {
  const p = data.policies.find((p) => p.id === id);
  showModal(
    "Edit access policy",
    `<form><div class="field"><label for="pname">Policy name</label><input name="name" id="pname" value="${esc(p.name)}" required maxlength="60"></div><div class="field"><label for="pdesc">Description</label><input name="description" id="pdesc" value="${esc(p.description)}" maxlength="200"></div><label class="checkbox"><input name="write" type="checkbox" ${p.write ? "checked" : ""}>Allow writes to the mounted workspace</label><label class="checkbox"><input name="network" type="checkbox" ${p.network ? "checked" : ""}>Allow unrestricted outbound network</label><div class="field"><label for="timeout">Runtime limit (seconds)</label><input id="timeout" name="timeout" type="number" min="10" max="3600" value="${p.timeout}" required></div><p class="micro-note">Changes apply only to future runs. Existing and pending runs keep their policy snapshots.</p><div class="error" role="alert"></div><div class="form-actions"><button class="primary">Save policy</button></div></form>`,
  );
  modal.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.submitter.disabled = true;
    try {
      await request(
        `/policies/${id}`,
        {
          name: f.get("name"),
          description: f.get("description"),
          write: f.has("write"),
          network: f.has("network"),
          timeout: Number(f.get("timeout")),
        },
        "PUT",
      );
      modal.close();
      await refresh();
      toast("Policy saved for future runs.");
    } catch (err) {
      modal.querySelector(".error").textContent = err.message;
      e.submitter.disabled = false;
    }
  };
}
function confirmAction(titleText, description, callback) {
  showModal(
    titleText,
    `<p>${description}</p><div class="error" role="alert"></div><div class="form-actions"><button data-cancel>Cancel</button><button class="danger" data-confirm>Confirm</button></div>`,
  );
  modal.querySelector("[data-cancel]").onclick = () => modal.close();
  modal.querySelector("[data-confirm]").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await callback();
      modal.close();
      await refresh();
    } catch (err) {
      modal.querySelector(".error").textContent = err.message;
      e.target.disabled = false;
    }
  };
}
async function runAction(id, action) {
  if (busy) return;
  busy = true;
  try {
    await request(`/runs/${id}/${action}`, {});
    await refresh();
    toast(
      {
        approve: "Run approved.",
        deny: "Run denied.",
        pause: "Agent paused.",
        resume: "Agent resumed.",
        stop: "Agent stopped.",
      }[action],
    );
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
}
function bind() {
  app.querySelectorAll("[data-nav]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.nav;
        render();
      }),
  );
  const rows = () =>
    app.querySelectorAll("[data-run]").forEach((row) => {
      const select = () => {
        selected = row.dataset.run;
        render();
      };
      row.onclick = select;
      row.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      };
    });
  rows();
  app.querySelectorAll("[data-run-action]").forEach(
    (b) =>
      (b.onclick = () => {
        const { id, runAction: action } = b.dataset;
        if (action === "stop")
          confirmAction(
            "Stop this agent?",
            "The container will be terminated. Completed writes and external actions will not be reversed.",
            () => request(`/runs/${id}/stop`, {}),
          );
        else runAction(id, action);
      }),
  );
  app
    .querySelectorAll("[data-policy]")
    .forEach((b) => (b.onclick = () => editPolicy(b.dataset.policy)));
  app.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        const action = b.dataset.action;
        if (action === "launch") launchModal();
        if (action === "export") {
          const blob = new Blob(
              [
                JSON.stringify(
                  {
                    exportedAt: new Date().toISOString(),
                    mode: data.mode,
                    workspace: data.workspace,
                    events: data.events,
                  },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            ),
            url = URL.createObjectURL(blob),
            a = document.createElement("a");
          a.href = url;
          a.download = `agent-watch-audit-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast("Audit exported. Keep local audit files private.");
        }
        if (action === "emergency")
          confirmAction(
            "Stop all agents?",
            "Running and paused containers will be terminated. Pending runs will be denied. Completed changes will remain.",
            async () => {
              const r = await request("/stop-all", {});
              if (r.failures?.length)
                throw Error(
                  `Could not stop ${r.failures.length} containers. Check Docker immediately.`,
                );
              toast("All active runs stopped.");
            },
          );
        if (action === "run-audit") {
          auditRun = b.dataset.id;
          auditQuery = "";
          view = "audit";
          render();
        }
        if (action === "reset")
          confirmAction(
            "Reset demo workspace?",
            "This clears only the simulated runs, policies, and audit events stored in this browser.",
            async () => {
              demo.reset();
              selected = null;
              toast("Demo reset.");
            },
          );
        if (action === "logout") {
          token = "";
          data = null;
          sessionStorage.removeItem("agent-watch-token");
          renderLogin();
        }
        if (action === "health") {
          try {
            health = await request("/health", undefined, "GET");
            render();
          } catch (e) {
            toast(e.message);
          }
        }
      }),
  );
  const search = app.querySelector("#search");
  if (search)
    search.oninput = (e) => {
      query = e.target.value;
      app.querySelector("#fleet").innerHTML = fleet();
      rows();
    };
  const status = app.querySelector("#filter");
  if (status)
    status.onchange = (e) => {
      filter = e.target.value;
      app.querySelector("#fleet").innerHTML = fleet();
      rows();
    };
  const auditFilter = app.querySelector("#audit-filter");
  if (auditFilter)
    auditFilter.onchange = (e) => {
      auditRun = e.target.value;
      render();
    };
  const auditSearch = app.querySelector("#audit-search");
  if (auditSearch)
    auditSearch.oninput = (e) => {
      auditQuery = e.target.value;
      app.querySelector("#audit-events").innerHTML = events(
        data.events
          .filter(
            (x) =>
              (auditRun === "all" || x.runId === auditRun) &&
              `${x.message} ${x.type}`
                .toLowerCase()
                .includes(auditQuery.toLowerCase()),
          )
          .reverse(),
      );
    };
}
if (local && !token) renderLogin();
else await refresh();
setInterval(
  async () => {
    if (!data) return;
    if (!local) demo.tick();
    if (
      !modal.open &&
      !["INPUT", "SELECT", "TEXTAREA"].includes(
        document.activeElement?.tagName,
      ) &&
      !busy
    )
      await refresh();
  },
  local ? 3000 : 12000,
);
