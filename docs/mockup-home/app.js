/* NerveCenter home + projects mock (v4). Static, hash-routed, no build step. BRANDS, ICONS, icon() live in assets.js.
   Roles: the app role (Admin, Developer, Viewer) decides who runs the app and who may create projects; the project
   role (Owner, Developer, Viewer) decides what a person can do inside one project. Open projects are view-only for everyone. */

// ---------------------------------------------------------------- data
const PEOPLE = {
  MS: "Mitesh Shinde", PN: "Priya Nair", AM: "Arjun Mehta", AS: "Ana Souza", RV: "Rahul Verma", SK: "Sneha Kulkarni", BS: "Bhawin Shah", KW: "Kenji Watanabe",
  JL: "Julia Lee", TO: "Tom Osei", RB: "Rita Banerjee", AL: "Alex Lin", DK: "Dev Kapoor", SR: "Sara Rahman", NV: "Nikhil Verma", EH: "Emma Hart", CF: "Carlos Fuentes",
  LB: "Lena Berg", GT: "Grace Tan", ER: "Elena Rossi", DO: "Daniel Okafor", RK: "Ravi Kumar", MI: "Meera Iyer",
};
// The app role of everyone who has signed in. New people start as Viewer.
const USERS = [
  ["MS", "Admin", "now"], ["PN", "Admin", "2h"], ["AM", "Developer", "12m"], ["AS", "Developer", "1h"], ["RV", "Developer", "3h"], ["SK", "Developer", "1d"],
  ["JL", "Developer", "35m"], ["DK", "Developer", "3h"], ["EH", "Developer", "1d"], ["ER", "Developer", "4h"], ["DO", "Developer", "2d"], ["CF", "Developer", "6h"],
  ["SR", "Developer", "2h"], ["KW", "Viewer", "5d"], ["BS", "Viewer", "2d"], ["TO", "Viewer", "1d"], ["RK", "Viewer", "1h"], ["MI", "Viewer", "—"],
].map(([code, app, at]) => ({ code, app, at, email: PEOPLE[code].toLowerCase().replace(" ", ".") + "@zs.com" }));

const PROJECTS = [
  { id: "data-ops", name: "Data Operations", hue: "indigo", seed: 11, open: false, created: "12 Sep", failing: 2, running: 3, tickets: 12, dq: 98.2, pipelines: 24,
    members: { MS: "Owner", PN: "Owner", AM: "Developer", AS: "Developer", RV: "Developer", SK: "Developer", BS: "Viewer", KW: "Viewer" } },
  { id: "commercial", name: "Commercial Analytics", hue: "teal", seed: 23, open: true, created: "18 Sep", failing: 0, running: 1, tickets: 7, dq: 99.6, pipelines: 16,
    members: { JL: "Owner", MS: "Developer", KW: "Developer", TO: "Viewer" } },
  { id: "field-force", name: "Field Force Effectiveness", hue: "amber", seed: 37, open: false, created: "21 Sep", failing: 1, running: 0, tickets: 4, dq: 97.1, pipelines: 11,
    members: { DK: "Owner", MS: "Developer", SR: "Developer", AM: "Viewer" } },
  { id: "patient-services", name: "Patient Services Data", hue: "rose", seed: 41, open: false, created: "25 Sep", failing: 0, running: 2, tickets: 3, dq: 99.9, pipelines: 9,
    members: { EH: "Owner", CF: "Developer", MS: "Viewer" } },
  { id: "finance-hub", name: "Finance Data Hub", hue: "green", seed: 5, open: true, created: "29 Sep", failing: 0, running: 0, tickets: 2, dq: 99.2, pipelines: 6,
    members: { ER: "Owner", PN: "Developer" } },
  { id: "medical-affairs", name: "Medical Affairs Insights", hue: "sky", seed: 7, open: false, created: "2 Oct", failing: 0, running: 1, tickets: 5, dq: 98.8, pipelines: 8,
    members: { DO: "Owner", RK: "Viewer" } },
];
// Connections live in the admin's library; owners can only grant the ones an admin marked shareable.
const CONNS = [
  { id: "servicenow", name: "ServiceNow", host: "zsdev.service-now.com", share: true, filter: "Assignment groups", hint: "DataOps L2", used: ["data-ops", "patient-services"] },
  { id: "jira", name: "Jira", host: "zs.atlassian.net", share: true, filter: "Project keys", hint: "MMM", used: ["data-ops", "commercial", "field-force"] },
  { id: "databricks", name: "Databricks", host: "analytics workspace", share: true, filter: "Jobs matching", hint: "mmm_*", used: ["data-ops", "commercial", "finance-hub"] },
  { id: "snowflake", name: "Snowflake", host: "COMM_WH", share: false, used: ["commercial"] },
  { id: "bitbucket", name: "Bitbucket", host: "data-platform", share: false, used: ["data-ops"] },
];
const KNOWLEDGE = ["Data platform runbooks", "SQL standards", "Pharma glossary", "Vendor feeds"];
const SKILLS = ["Root cause analysis", "Remediation", "Data quality checks", "Ticket triage", "Boards"];

// Who the mock is showing. The dock's "As" button switches between them.
const PERSONAS = { admin: "MS", developer: "AM", viewer: "BS", new: "MI" };
let AS = localStorage.getItem("nc-mock-as") || "admin";
const meUser = () => USERS.find((u) => u.code === PERSONAS[AS]);
const ME = () => { const u = meUser(); return { code: u.code, name: PEOPLE[u.code], first: PEOPLE[u.code].split(" ")[0], app: u.app, email: u.email }; };
const isAdmin = () => ME().app === "Admin";
const canCreate = () => ME().app !== "Viewer";
/** Your role in a project: your membership, else Admin for app admins, else View only if the project is open. */
function roleIn(p, code = ME().code) {
  if (p.members[code]) return p.members[code];
  if (USERS.find((u) => u.code === code)?.app === "Admin") return "Admin";
  return p.open ? "View only" : null;
}
const manages = (p) => ["Owner", "Admin"].includes(roleIn(p));

// Dither palettes, paper first. In dark mode the ramp runs toward light so lit surfaces glow.
const RAMPS = {
  light: {
    indigo: ["#f5f3ee", "#dcdcf6", "#a3a5ee", "#5b5bd6", "#2b2c7e"],
    teal: ["#f5f3ee", "#cfece6", "#82d0c3", "#1f9e8c", "#0e5a51"],
    amber: ["#f5f3ee", "#fbe4c1", "#f3b860", "#d6801a", "#83490a"],
    rose: ["#f5f3ee", "#f5d5e8", "#e494c4", "#c2408f", "#741d53"],
    sky: ["#f5f3ee", "#d5e8f8", "#8fc3ef", "#2b84d6", "#164c7e"],
    green: ["#f5f3ee", "#d7ecd6", "#93cf96", "#2f9e4a", "#185c29"],
    stone: ["#f5f3ee", "#e6e3dc", "#c4c0b7", "#8f8a80", "#4d4a44"],
  },
  dark: {
    indigo: ["#121211", "#1e1f3d", "#34357f", "#7876f0", "#d6d4ff"],
    teal: ["#121211", "#112a27", "#1b5c53", "#3cc3ae", "#c4f3ea"],
    amber: ["#121211", "#2c2111", "#6a4614", "#f0a43a", "#ffe6bb"],
    rose: ["#121211", "#2c1625", "#6a2a55", "#e869b5", "#ffd3ec"],
    sky: ["#121211", "#12233a", "#1f4f80", "#5aaaf0", "#d3eaff"],
    green: ["#121211", "#132616", "#245a2f", "#5cc874", "#d3f5d9"],
    stone: ["#121211", "#1d1c1a", "#34322e", "#6b675f", "#bdb8ae"],
  },
};

// ---------------------------------------------------------------- helpers
const $ = (selector, root = document) => root.querySelector(selector);
const isDark = () => document.documentElement.dataset.theme === "dark";
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(text) { let h = 2166136261; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const byId = (id) => PROJECTS.find((p) => p.id === id);
const ramp = (hue) => RAMPS[isDark() ? "dark" : "light"][hue];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TINTS = [["#e0e7ff", "#4338ca"], ["#e0f2fe", "#0369a1"], ["#ccfbf1", "#0f766e"], ["#ede9fe", "#6d28d9"], ["#fef3c7", "#b45309"], ["#fae8ff", "#a21caf"], ["#cffafe", "#0e7490"], ["#ffedd5", "#c2410c"]];
const TINTS_DARK = [["#26264d", "#b4b8ff"], ["#13304a", "#8fd0ff"], ["#11342f", "#7fe0d0"], ["#2c2350", "#c9b5ff"], ["#3a2c12", "#fbcd75"], ["#3a1d3f", "#f0a6f7"], ["#10343b", "#7fdcef"], ["#3d2615", "#ffb07a"]];
function avatar(code, size = 22) {
  const tints = isDark() ? TINTS_DARK : TINTS; const [bg, fg] = tints[hash(PEOPLE[code] || code) % tints.length];
  return `<span class="avatar" title="${esc(PEOPLE[code] || code)}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${bg};color:${fg}">${code}</span>`;
}
function brand(name, size = 15) {
  const mark = BRANDS[name]; const color = isDark() && mark.darkHex ? mark.darkHex : mark.hex;
  return `<svg class="mk" width="${size}" height="${size}" viewBox="${mark.viewBox || "0 0 24 24"}" aria-label="${name}"><path d="${mark.path}" fill="#${color}"/></svg>`;
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }

// ---------------------------------------------------------------- dithering
const BAYER = (() => { let m = [[0]]; while (m.length < 8) { const s = m.length; const n = []; for (let y = 0; y < 2 * s; y++) { n.push([]); for (let x = 0; x < 2 * s; x++) n[y].push(m[y % s][x % s] * 4 + [[0, 2], [3, 1]][Math.floor(y / s)][Math.floor(x / s)]); } m = n; } return m.map((r) => r.map((v) => (v + 0.5) / 64)); })();
/** Index into a ramp for value v (0..1) at pixel x,y, ordered-dithered between neighbouring tones. */
function toneAt(v, x, y, steps) { const t = Math.max(0, Math.min(1, v)) * (steps - 1); const i = Math.floor(t); return Math.min(steps - 1, t - i > BAYER[y & 7][x & 7] ? i + 1 : i); }

/** A dithered landscape unique to a project: sky, a sun, three ridgelines. `t` drifts the ridges (hover). */
function paintLandscape(canvas, p, t = 0) {
  const w = canvas.width; const h = canvas.height; const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h); const tones = ramp(p.hue).map(hex);
  const r = rng(p.seed * 97 + 13);
  const sun = { x: w * (0.18 + r() * 0.64), y: h * (0.2 + r() * 0.16), r: h * (0.13 + r() * 0.05) };
  const layers = [0, 1, 2].map((k) => ({ base: h * (0.42 + k * 0.15), amp: h * (0.17 - k * 0.035), f: [0.03 + r() * 0.04, 0.07 + r() * 0.06, 0.16 + r() * 0.1], ph: [r() * 6, r() * 6, r() * 6], v: [0.4, 0.62, 0.86][k], drift: (k + 1) * 0.6 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0.2 - (y / h) * 0.16;
    if (Math.hypot(x - sun.x, (y - sun.y) * 1.05) < sun.r) v = 0.42;
    for (const L of layers) {
      const X = x + t * L.drift;
      const ridge = L.base - L.amp * (Math.sin(X * L.f[0] + L.ph[0]) + 0.55 * Math.sin(X * L.f[1] + L.ph[1]) + 0.22 * Math.sin(X * L.f[2] + L.ph[2])) / 1.77;
      if (y >= ridge) v = L.v + ((y - ridge) / h) * 0.22;
    }
    const c = tones[toneAt(v, x, y, tones.length)]; const o = (y * w + x) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const art = (p, w, h, cls = "art") => `<canvas class="${cls}" width="${w}" height="${h}" data-art="${p.id || "draft"}"></canvas>`;
function paintAll(root = document) { root.querySelectorAll("canvas[data-art]").forEach((c) => { const p = c.dataset.art === "draft" ? draftProject() : byId(c.dataset.art); if (p) paintLandscape(c, p); }); }
const tile = (p, size = 34) => `<span class="ptile" style="width:${size}px;height:${size}px">${art(p, 18, 18)}</span>`;

const HUE_INK = { indigo: "#5b5bd6", teal: "#1f9e8c", amber: "#d6801a", rose: "#c2408f", sky: "#2b84d6", green: "#2f9e4a" };

// ---------------------------------------------------------------- top bar
let menuOpen = false;
function topbar(crumb = "") {
  const me = ME();
  const menu = menuOpen ? `<div class="menu" role="menu">
      <div class="menu-who">${avatar(me.code, 34)}<div><b>${esc(me.name)}</b><small>${esc(me.email)}</small></div><span class="pill ${me.app === "Admin" ? "admin" : ""}">${me.app}</span></div>
      ${isAdmin() ? `<a class="mi" href="#/admin">${icon("users", 15)}Admin console</a>` : ""}
      <a class="mi">${icon("settings", 15)}Settings</a>
      <button class="mi" data-theme-toggle>${icon(isDark() ? "sun" : "moon", 15)}${isDark() ? "Light" : "Dark"} theme</button>
      <div class="menu-sep"></div>
      <a class="mi">${icon("arrow", 15)}Sign out</a>
    </div>` : "";
  return `<header class="top" id="top">
    <a class="brandmark" href="#/"><img src="nervecenter-favicon.svg" alt="">NerveCenter</a>${crumb}
    <span class="grow"></span>
    <button class="search" aria-label="Search">${icon("search", 15)}<kbd>Ctrl K</kbd></button>
    ${isAdmin() ? '<a class="btn ghost topadmin" href="#/admin">Admin console</a>' : ""}
    <button class="me-btn" id="me" aria-haspopup="menu" aria-expanded="${menuOpen}">${avatar(me.code, 30)}</button>
    ${menu}
  </header>`;
}
function wireTopbar() {
  $("#me")?.addEventListener("click", (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); });
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => { menuOpen = false; toggleTheme(); });
}
document.addEventListener("click", (e) => { if (menuOpen && !e.target.closest(".menu")) { menuOpen = false; render(); } });

// ---------------------------------------------------------------- home
function card(p, big = false, role = roleIn(p)) {
  return `<a class="pcard" href="#/p/${p.id}" data-p="${p.id}">
    ${big ? art(p, 252, 122) : art(p, 168, 66)}
    <div class="pbody"><b>${esc(p.name)}</b><span class="mono">${role}</span></div>
  </a>`;
}

function footer() {
  return `<footer class="foot">
    <div class="wrap foot-top">
      <div class="foot-brand"><img src="nervecenter-favicon.svg" alt="" width="22" height="22"><span>NerveCenter</span></div>
      <nav class="foot-cols">
        <div><span class="mono">Workspace</span><a href="#/">Projects</a>${canCreate() ? '<a href="#/new">New project</a>' : ""}${isAdmin() ? '<a href="#/admin">Admin console</a>' : ""}</div>
        <div><span class="mono">Help</span><a>Docs</a><a>Release notes</a><a>Support</a></div>
        <div><span class="mono">ZS</span><a>Privacy</a><a>Terms</a></div>
      </nav>
      <div class="foot-live"><span class="mono" id="clock">PUNE --:--:--</span><span class="mono ok"><i></i>Operational</span></div>
    </div>
    <div class="wrap foot-word"><canvas id="wordmark" aria-label="NerveCenter"></canvas><canvas id="scene" aria-hidden="true"></canvas></div>
    <div class="wrap foot-base mono"><span>© 2026 ZS Associates</span><span>v2.6</span></div>
  </footer>`;
}
function tickFooterClock() { const el = document.getElementById("clock"); if (el) el.textContent = `PUNE ${new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })}`; }
setInterval(tickFooterClock, 1000);

const mine = () => PROJECTS.filter((p) => p.members[ME().code]);
const others = () => PROJECTS.filter((p) => !p.members[ME().code] && roleIn(p));

function renderHome() {
  const me = ME(); const date = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const newTile = canCreate() ? `<a class="pcard newp" href="#/new" aria-label="New project"><span class="plus">${icon("plus", 20)}</span></a>` : "";
  const own = mine(); const rest = others();
  return `${topbar()}
  <main class="paper">
    <section class="wrap hero">
      <div class="hero-text">
        <span class="mono eyebrow">${date}</span>
        <h1 class="hello display">${greeting()},<br>${esc(me.first)}.</h1>
        <p class="lede">The operations harness for data teams. Tickets, pipelines and data quality in one place, with Sonic to investigate and fix what breaks.</p>
      </div>
      <div class="ring-wrap"><canvas id="ring" width="150" height="150" aria-hidden="true"></canvas></div>
    </section>
    <section class="wrap block">
      <div class="head"><h2>Projects</h2><span class="grow"></span>${canCreate() ? `<a class="btn primary" href="#/new">${icon("plus", 15)} New project</a>` : ""}</div>
      ${own.length || newTile ? `<div class="pgrid stagger">${own.map((p) => card(p)).join("")}${newTile}</div>`
        : `<div class="noproj"><span class="mono">No projects yet</span><p>A project owner or an admin can add you.</p></div>`}
      ${rest.length ? `<div class="subhead mono">${isAdmin() ? "Everything else" : "Open to everyone"}</div>
      <div class="pgrid stagger">${rest.map((p) => card(p)).join("")}</div>` : ""}
    </section>
  </main>
  ${footer()}`;
}

function wireHome() {
  paintAll(); setupRing($("#ring"), [...mine(), ...others()].map((p) => p.hue)); setupFooter(); tickFooterClock();
  // Hovering a card lets its landscape drift.
  document.querySelectorAll(".pcard[data-p]").forEach((el) => {
    const c = el.querySelector("canvas"); const p = byId(el.dataset.p); let raf = 0; let t = 0;
    el.addEventListener("mouseenter", () => { if (still()) return; const step = () => { t += 0.6; paintLandscape(c, p, t); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); });
    el.addEventListener("mouseleave", () => cancelAnimationFrame(raf));
  });
}

// ---------------------------------------------------------------- admin console
let adminTab = "People"; let adminUser = "RK"; let adminProject = "commercial"; let adminFilter = "All";
const roleSelect = (role) => `<span class="select">${role} ${icon("down", 13)}</span>`;
const toggle = (on, attrs = "") => `<button type="button" class="tg ${on ? "on" : ""}" role="switch" aria-checked="${on}" ${attrs}></button>`;
const projectsOf = (code) => PROJECTS.filter((p) => p.members[code]);

function adminPeople() {
  const rows = USERS.filter((u) => adminFilter === "All" || u.app === adminFilter.replace(/s$/, ""));
  const sel = USERS.find((u) => u.code === adminUser);
  const drawer = sel ? `<aside class="drawer">
      <div class="dhead">${avatar(sel.code, 44)}<div><b>${PEOPLE[sel.code]}</b><small class="mono">${sel.email}</small></div><button class="btn ghost icon" data-close aria-label="Close">${icon("x", 16)}</button></div>
      <div class="f"><span class="lbl">App role</span><div class="seg wide">${["Viewer", "Developer", "Admin"].map((r) => `<button class="${sel.app === r ? "on" : ""}" data-app="${r}">${r}</button>`).join("")}</div></div>
      <div class="f"><span class="lbl">Projects</span>
        <div class="plist">${projectsOf(sel.code).map((p) => `<div class="prow">${tile(p, 28)}<b>${esc(p.name)}</b>${roleSelect(p.members[sel.code])}<button class="btn ghost icon sm" aria-label="Remove">${icon("x", 14)}</button></div>`).join("") || '<div class="empty mono">No projects</div>'}</div>
        <div class="addrow"><span class="select wide">${tile(PROJECTS[0], 20)} ${esc(PROJECTS[0].name)} ${icon("down", 13)}</span>${roleSelect("Viewer")}<button class="btn">Add</button></div>
      </div>
      <button class="btn ghost danger">Block</button>
    </aside>` : "";
  const counts = { All: USERS.length, Admins: USERS.filter((u) => u.app === "Admin").length, Developers: USERS.filter((u) => u.app === "Developer").length, Viewers: USERS.filter((u) => u.app === "Viewer").length };
  return { drawer, body: `
    <div class="toolbar"><label class="field">${icon("search", 15)}<input placeholder="Find a person"></label>
      <div class="seg">${Object.entries(counts).map(([k, n]) => `<button class="${adminFilter === k ? "on" : ""}" data-filter="${k}">${k === "All" ? "Everyone" : k} <span class="mono">${n}</span></button>`).join("")}</div></div>
    <div class="card list">
      <div class="lrow lhead mono"><span>Person</span><span>App role</span><span>Projects</span><span>Active</span></div>
      ${rows.map((u) => `<button class="lrow ${u.code === adminUser ? "on" : ""}" data-user="${u.code}"><span class="who">${avatar(u.code, 30)}<span><b>${PEOPLE[u.code]}</b><small class="mono">${u.email}</small></span></span>
        <span>${u.app === "Admin" ? '<span class="pill admin">Admin</span>' : `<span class="ink-3">${u.app}</span>`}</span>
        <span class="ptiles">${projectsOf(u.code).map((p) => tile(p, 22)).join("") || '<span class="ink-5">—</span>'}</span>
        <span class="ink-4">${u.at}</span></button>`).join("")}
    </div>` };
}

function adminProjects() {
  const sel = byId(adminProject);
  const owners = (p) => Object.entries(p.members).filter(([, r]) => r === "Owner").map(([c]) => c);
  const drawer = sel ? `<aside class="drawer">
      <div class="dhead">${tile(sel, 44)}<div><b>${esc(sel.name)}</b><small class="mono">${sel.id}</small></div><button class="btn ghost icon" data-close aria-label="Close">${icon("x", 16)}</button></div>
      <div class="optrow"><div><b>Open to everyone</b><small>Anyone signed in can view it</small></div>${toggle(sel.open, `data-open="${sel.id}"`)}</div>
      <div class="f"><span class="lbl">Members</span>
        <div class="plist">${Object.entries(sel.members).map(([code, role]) => `<div class="prow">${avatar(code, 28)}<b>${PEOPLE[code]}</b>${roleSelect(role)}<button class="btn ghost icon sm" aria-label="Remove">${icon("x", 14)}</button></div>`).join("")}</div>
        <div class="addrow"><label class="field" style="flex:1">${icon("search", 14)}<input placeholder="Add a person"></label>${roleSelect("Viewer")}<button class="btn">Add</button></div>
      </div>
      <div class="drow"><a class="btn sm" href="#/p/${sel.id}/settings">Open settings</a><span class="grow"></span><button class="btn ghost danger">Archive</button></div>
    </aside>` : "";
  return { drawer, body: `
    <div class="toolbar"><label class="field">${icon("search", 15)}<input placeholder="Find a project"></label><span class="grow"></span>
      <a class="btn primary" href="#/new">${icon("plus", 15)} New project</a></div>
    <div class="card list">
      <div class="lrow proj lhead mono"><span>Project</span><span>Owners</span><span>People</span><span>Open</span><span>Created</span></div>
      ${PROJECTS.map((p) => `<div class="lrow proj ${p.id === adminProject ? "on" : ""}" data-proj="${p.id}" role="button" tabindex="0">
        <span class="who">${tile(p, 30)}<span><b>${esc(p.name)}</b><small class="mono">${p.id}</small></span></span>
        <span class="avs">${owners(p).map((c) => avatar(c, 24)).join("")}</span>
        <span class="ink-3">${Object.keys(p.members).length}</span>
        <span>${toggle(p.open, `data-open="${p.id}"`)}</span>
        <span class="ink-4">${p.created}</span></div>`).join("")}
    </div>` };
}

function adminConnections() {
  return { drawer: "", body: `
    <div class="toolbar"><label class="field">${icon("search", 15)}<input placeholder="Find a connection"></label><span class="grow"></span>
      <button class="btn primary">${icon("plus", 15)} New connection</button></div>
    <div class="card list">
      <div class="lrow conn lhead mono"><span>Connection</span><span>Used by</span><span>Owners can grant</span></div>
      ${CONNS.map((c) => `<div class="lrow conn"><span class="who"><span class="cmark">${brand(c.id, 18)}</span><span><b>${c.name}</b><small class="mono">${c.host}</small></span></span>
        <span class="ptiles">${c.used.map((id) => tile(byId(id), 22)).join("")}</span>
        <span>${toggle(c.share, `data-share="${c.id}"`)}</span></div>`).join("")}
    </div>` };
}

function adminAudit() {
  const rows = [
    ["12:41", "MS", "project.open", "Commercial Analytics is open to everyone"], ["12:02", "JL", "project.member.add", "Tom Osei to Commercial Analytics as Viewer"],
    ["11:30", "MS", "user.role", "Ravi Kumar: Viewer"], ["10:55", "DO", "project.create", "Medical Affairs Insights"], ["10:12", "PN", "connection.share", "Databricks: owners can grant"],
  ];
  return { drawer: "", body: `<div class="card list">
      <div class="lrow audit lhead mono"><span>Time</span><span>Who</span><span>Action</span><span>What</span></div>
      ${rows.map(([t, who, act, what]) => `<div class="lrow audit"><span class="mono ink-4">${t}</span><span class="who">${avatar(who, 24)}${PEOPLE[who]}</span><span class="mono ink-3">${act}</span><span>${esc(what)}</span></div>`).join("")}
    </div>` };
}

function renderAdmin() {
  const view = { People: adminPeople, Projects: adminProjects, Connections: adminConnections, "Audit log": adminAudit }[adminTab]();
  return `${topbar('<span class="crumb">/</span><span class="crumb">Admin console</span>')}
  <main class="paper"><div class="wrap admin ${view.drawer ? "with-drawer" : ""}">
    <h1 class="display">Admin console</h1>
    <div class="seg tabs-top">${["People", "Projects", "Connections", "Audit log"].map((t) => `<button class="${adminTab === t ? "on" : ""}" data-tab="${t}">${t}</button>`).join("")}</div>
    <div class="admin-grid"><div>${view.body}</div>${view.drawer}</div>
  </div></main>`;
}
function wireAdmin() {
  paintAll();
  document.querySelectorAll("[data-user]").forEach((b) => b.addEventListener("click", () => { adminUser = b.dataset.user; render(); }));
  document.querySelectorAll("[data-proj]").forEach((b) => b.addEventListener("click", () => { adminProject = b.dataset.proj; render(); }));
  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { adminFilter = b.dataset.filter; render(); }));
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { adminTab = b.dataset.tab; render(); }));
  document.querySelectorAll("[data-app]").forEach((b) => b.addEventListener("click", () => { USERS.find((u) => u.code === adminUser).app = b.dataset.app; render(); }));
  document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const p = byId(b.dataset.open); p.open = !p.open; render(); }));
  document.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => { const c = CONNS.find((x) => x.id === b.dataset.share); c.share = !c.share; render(); }));
  $("[data-close]")?.addEventListener("click", () => { adminUser = null; adminProject = null; render(); });
}

// ---------------------------------------------------------------- new project
const STEPS = ["Basics", "Sources", "Knowledge", "Sonic", "People"];
const freshDraft = () => ({ step: 0, name: "", id: "", idTouched: false, hue: "teal", desc: "", from: "blank", grants: {}, kb: new Set(), skills: new Set(["Root cause analysis", "Remediation"]), model: "Sonnet 5.5", sonic: "ask", invites: [], adding: "Developer", open: false });
let draft = freshDraft();
function draftProject() { const name = draft.name.trim() || "Untitled"; return { id: "draft", name, hue: draft.hue, seed: hash(name) % 9973, members: {} }; }
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

function stepBody() {
  const seg = (group, options) => `<div class="seg wide">${options.map(([id, label]) => `<button type="button" class="${draft[group] === id ? "on" : ""}" data-${group}="${id}">${label}</button>`).join("")}</div>`;
  const hues = ["indigo", "teal", "amber", "rose", "sky", "green"];
  if (draft.step === 0) return `
    <div class="f"><label class="lbl" for="pname">Name</label><input id="pname" class="inp big" placeholder="Market Mix Modelling" value="${esc(draft.name)}" autocomplete="off"></div>
    <div class="frow">
      <div class="f"><label class="lbl" for="pid">ID</label><input id="pid" class="inp mono" placeholder="market-mix" value="${esc(draft.id)}"></div>
      <div class="f"><span class="lbl">Colour</span><div class="swatches">${hues.map((h) => `<button type="button" class="swatch ${draft.hue === h ? "on" : ""}" data-hue="${h}" style="background:${RAMPS.light[h][3]}" aria-label="${h}"></button>`).join("")}</div></div>
    </div>
    <div class="f"><label class="lbl" for="pdesc">Description</label><input id="pdesc" class="inp" placeholder="Optional" value="${esc(draft.desc)}"></div>
    <div class="f"><span class="lbl">Start from</span>${seg("from", [["blank", "Blank"], ["copy", "Copy settings from a project"]])}</div>
    ${draft.from === "copy" ? `<div class="f"><span class="select wide big">${tile(PROJECTS[0], 22)} ${esc(PROJECTS[0].name)} ${icon("down", 13)}</span></div>` : ""}`;
  if (draft.step === 1) return `
    <div class="f"><span class="lbl">Connections</span>
      <div class="grants">${CONNS.map((c) => { const g = draft.grants[c.id]; const allowed = c.share || isAdmin(); return `
        <div class="grant ${g ? "on" : ""} ${allowed ? "" : "off"}">
          <div class="grow-row"><span class="cmark">${brand(c.id, 18)}</span><span class="gname"><b>${c.name}</b><small class="mono">${c.host}</small></span>
            ${allowed ? toggle(Boolean(g), `data-grant="${c.id}"`) : '<span class="mono ink-5">Ask an admin</span>'}</div>
          ${g && c.filter ? `<label class="gfilter"><span class="mono">${c.filter}</span><input class="inp" placeholder="${c.hint}" value="${esc(g.filter || "")}" data-filter-for="${c.id}"></label>` : ""}
        </div>`; }).join("")}</div></div>`;
  if (draft.step === 2) return `
    <div class="f"><span class="lbl">Knowledge</span><div class="chips">${KNOWLEDGE.map((k) => `<button type="button" class="chip ${draft.kb.has(k) ? "on" : ""}" data-kb="${k}">${icon("knowledge", 14)}<b>${k}</b></button>`).join("")}</div></div>
    <div class="f"><span class="lbl">Skills</span><div class="chips">${SKILLS.map((k) => `<button type="button" class="chip ${draft.skills.has(k) ? "on" : ""}" data-skill="${k}">${icon("skills", 14)}<b>${k}</b></button>`).join("")}</div></div>`;
  if (draft.step === 3) return `
    <div class="f"><span class="lbl">Model</span>${seg("model", [["Sonnet 5.5", "Sonnet 5.5"], ["Opus 5.5", "Opus 5.5"], ["Fable 5.1", "Fable 5.1"]])}</div>
    <div class="f"><span class="lbl">Sonic may</span>${seg("sonic", [["read", "Only read"], ["ask", "Act after approval"], ["dev", "Act in dev"]])}</div>`;
  return `
    <div class="f"><span class="lbl">People</span>
      <div class="invite"><input id="invite" class="inp" placeholder="Name or email" autocomplete="off">${seg("adding", [["Viewer", "Viewer"], ["Developer", "Developer"], ["Owner", "Owner"]]).replace("seg wide", "seg")}<button type="button" class="btn" id="add">Add</button></div>
      <div class="people">${[{ code: ME().code, name: ME().name, role: "Owner" }, ...draft.invites].map((v) => `<span class="person">${avatar(v.code, 24)}<b>${esc(v.name)}</b><span class="mono">${v.role}</span></span>`).join("")}</div></div>
    ${isAdmin() ? `<div class="optrow"><div><b>Open to everyone</b><small>Anyone signed in can view it</small></div>${toggle(draft.open, "data-dopen")}</div>` : ""}`;
}

function renderNew() {
  if (!canCreate()) { location.hash = "#/"; return ""; }
  const last = draft.step === STEPS.length - 1;
  return `${topbar('<span class="crumb">/</span><span class="crumb">New project</span>')}
  <main class="paper"><div class="wrap np">
    <form class="npform" onsubmit="return false">
      <h1 class="display">New project</h1>
      <ol class="steps">${STEPS.map((s, i) => `<li><button type="button" class="${i === draft.step ? "on" : i < draft.step ? "done" : ""}" data-step="${i}" ${draft.name.trim() || i === 0 ? "" : "disabled"}><span class="mono">${String(i + 1).padStart(2, "0")}</span>${s}</button></li>`).join("")}</ol>
      <div class="stepbody">${stepBody()}</div>
      <div class="npactions">${draft.step ? '<button type="button" class="btn ghost" id="back">Back</button>' : '<a class="btn ghost" href="#/">Cancel</a>'}<span class="grow"></span>
        ${last ? "" : `<button type="button" class="btn" id="skip" ${draft.name.trim() ? "" : "disabled"}>Create now</button>`}
        <button type="button" class="btn primary" id="next" ${draft.name.trim() ? "" : "disabled"}>${last ? "Create project" : "Next"}</button></div>
    </form>
    <aside class="nppreview"><div class="pgrid one">${card(draftProject(), true, "Owner").replace(/href="[^"]*"/, "")}</div></aside>
  </div></main>`;
}

function createDraft() {
  const id = draft.id || slug(draft.name);
  PROJECTS.push({ id, name: draft.name.trim(), hue: draft.hue, seed: hash(draft.name) % 9973, open: draft.open, created: "Today", failing: 0, running: 0, tickets: 0, dq: 100, pipelines: 0,
    members: Object.fromEntries([[ME().code, "Owner"], ...draft.invites.map((v) => [v.code, v.role])]) });
  draft = freshDraft(); location.hash = `#/p/${id}`;
}

function wireNew() {
  paintAll();
  const refreshPreview = () => { const holder = $(".nppreview .pgrid"); holder.innerHTML = card(draftProject(), true, "Owner").replace(/href="[^"]*"/, ""); paintAll(holder); document.querySelectorAll("#next, #skip").forEach((b) => (b.disabled = !draft.name.trim())); };
  $("#pname")?.addEventListener("input", (e) => { draft.name = e.target.value; if (!draft.idTouched) { draft.id = slug(draft.name); $("#pid").value = draft.id; } refreshPreview(); });
  $("#pid")?.addEventListener("input", (e) => { draft.idTouched = true; draft.id = slug(e.target.value) || ""; });
  $("#pdesc")?.addEventListener("input", (e) => { draft.desc = e.target.value; });
  document.querySelectorAll("[data-hue]").forEach((b) => b.addEventListener("click", () => { draft.hue = b.dataset.hue; render(); }));
  ["from", "model", "sonic", "adding"].forEach((group) => document.querySelectorAll(`[data-${group}]`).forEach((b) => b.addEventListener("click", () => { draft[group] = b.dataset[group]; render(); })));
  document.querySelectorAll("[data-grant]").forEach((b) => b.addEventListener("click", () => { const id = b.dataset.grant; draft.grants[id] ? delete draft.grants[id] : (draft.grants[id] = { filter: "" }); render(); }));
  document.querySelectorAll("[data-filter-for]").forEach((i) => i.addEventListener("input", () => { draft.grants[i.dataset.filterFor].filter = i.value; }));
  document.querySelectorAll("[data-kb]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.kb; draft.kb.has(k) ? draft.kb.delete(k) : draft.kb.add(k); render(); }));
  document.querySelectorAll("[data-skill]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.skill; draft.skills.has(k) ? draft.skills.delete(k) : draft.skills.add(k); render(); }));
  $("[data-dopen]")?.addEventListener("click", () => { draft.open = !draft.open; render(); });
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { draft.step = Number(b.dataset.step); render(); }));
  $("#back")?.addEventListener("click", () => { draft.step--; render(); });
  $("#skip")?.addEventListener("click", createDraft);
  $("#next")?.addEventListener("click", () => { if (draft.step === STEPS.length - 1) createDraft(); else { draft.step++; render(); } });
  const add = () => { const v = $("#invite").value.trim(); if (!v) return; const code = Object.keys(PEOPLE).find((c) => PEOPLE[c].toLowerCase().startsWith(v.toLowerCase())) || v.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(); draft.invites.push({ code, name: PEOPLE[code] || v, role: draft.adding }); render(); };
  $("#add")?.addEventListener("click", add);
  $("#invite")?.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  $("#pname")?.focus();
}
window.fillDemo = () => {
  Object.assign(draft, { name: "Market Mix Modelling", id: "market-mix", hue: "sky", grants: { jira: { filter: "MMM" }, databricks: { filter: "mmm_*" } }, kb: new Set(["SQL standards", "Pharma glossary"]),
    invites: [{ code: "AS", name: "Ana Souza", role: "Developer" }, { code: "BS", name: "Bhawin Shah", role: "Viewer" }] });
  render();
};

// ---------------------------------------------------------------- inside a project
const NAV = [["overview", "Overview", "O"], ["ticket", "Tickets", "T"], ["pipes", "Pipelines", "P"], ["dq", "Data quality", "D"], ["boards", "Boards", "B"], ["tasks", "Tasks", "A"], ["inbox", "Inbox", "I"], ["routines", "Routines", "R"], ["skills", "Skills", "S"], ["knowledge", "Knowledge", "K"], ["connectors", "Connectors", "C"]];
let switcherOpen = false;

function shell(p, active, content) {
  const role = roleIn(p); const nav = NAV.map(([ic, label, key]) => `<a class="nav ${active === label ? "on" : ""}" href="#/p/${p.id}">${icon(ic, 16)}${label}<kbd>${key}</kbd></a>`).join("");
  const list = [...mine(), ...others()];
  const pop = switcherOpen ? `<div class="pop" style="left:10px;top:62px">
      <label class="field">${icon("search", 15)}<input placeholder="Switch project"></label>
      ${list.map((q) => `<a class="opt ${q.id === p.id ? "active" : ""}" href="#/p/${q.id}">${tile(q, 28)}<div class="what"><div>${esc(q.name)}</div><small class="mono">${roleIn(q)}</small></div>${q.id === p.id ? `<span style="color:rgb(var(--c-brand))">${icon("check", 15)}</span>` : ""}</a>`).join("")}
      <div style="height:1px;background:rgb(var(--c-line));margin:6px 4px"></div>
      <a class="opt" href="#/"><span class="ib">${icon("home", 15)}</span><div class="what"><div>All projects</div></div><kbd>G</kbd><kbd>H</kbd></a>
      ${canCreate() ? `<a class="opt" href="#/new"><span class="ib">${icon("plus", 15)}</span><div class="what"><div>New project</div></div></a>` : ""}
    </div>` : "";
  return `<div class="app">
    <aside class="side">
      <button class="switcher ${switcherOpen ? "open" : ""}" id="switcher">${tile(p, 34)}<span style="flex:1;min-width:0"><b>${esc(p.name)}</b><small class="mono">${role}</small></span><span class="ink-4">${icon("updown", 15)}</span></button>
      ${nav}
      ${role !== "View only" ? `<div class="sep"></div><a class="nav ${active === "Settings" ? "on" : ""}" href="#/p/${p.id}/settings">${icon("settings", 16)}Settings<kbd>,</kbd></a>` : ""}
      <div class="me">${avatar(ME().code, 28)}<div style="font-weight:600">${esc(ME().name)}</div></div>
      ${pop}
    </aside>
    <div class="main">${role === "View only" ? `<div class="viewonly"><span class="pill">${icon("lock", 12)} View only</span><span>Open to everyone</span><span class="grow"></span><button class="btn sm primary" id="request">Request access</button></div>` : ""}${content}</div>
  </div>`;
}

function renderProject(p) {
  const rows = [
    ["P1", "rose", "INC0031212", "veltrix_sales_daily_load failed at transform step", "servicenow", "Sonic working", "12m"],
    ["P2", "amber", "DATAOPS-482", "Snowflake role for Ana Souza", "jira", "Assigned to you", "2h"],
    ["P2", "amber", "INC0031207", "dq_rx_claims null rate above 2%", "servicenow", "Open", "3h"],
    ["P3", "", "DATAOPS-479", "Backfill territory_alignment for Q3", "jira", "In review", "1d"],
  ];
  return shell(p, "Overview", `
    <div class="bar"><span>${esc(p.name)}</span><span class="ink-5">/</span><b>Overview</b><span style="flex:1"></span>
      <button class="search" aria-label="Search">${icon("search", 15)}<kbd>Ctrl K</kbd></button>${avatar(ME().code, 28)}</div>
    <div class="content">
      <h1 class="title">Overview</h1><p class="meta">${p.pipelines} pipelines · ${Object.keys(p.members).length} people</p>
      <div class="tiles stagger">
        <div class="card tile"><span>Open tickets</span><b class="num" data-count="${p.tickets}">${p.tickets}</b></div>
        <div class="card tile"><span>Failing pipelines</span><b class="num rose" data-count="${p.failing}">${p.failing}</b></div>
        <div class="card tile"><span>Sonic running</span><b class="num brand" data-count="${p.running}">${p.running}</b></div>
        <div class="card tile"><span>DQ pass rate</span><b class="num" data-count="${p.dq}" data-dec="1" data-suffix="%">${p.dq}%</b></div>
      </div>
      <h2 class="sub">Needs attention <span class="num">${rows.length}</span></h2>
      <div class="card" style="border-radius:16px"><table class="t"><thead><tr><th style="width:80px">Priority</th><th style="width:130px">Ticket</th><th>Title</th><th style="width:70px">Source</th><th style="width:150px">Status</th><th style="width:90px">Updated</th></tr></thead>
      <tbody class="stagger">${rows.map(([pr, tone, id, title, src, status, at]) => `<tr><td><span class="pill ${tone}">${pr}</span></td><td class="num ink-3">${id}</td><td style="font-weight:550">${title}</td><td>${brand(src, 16)}</td><td>${status === "Sonic working" ? `<span class="pill admin"><span class="dot blink" style="background:rgb(var(--c-brand))"></span>Sonic working</span>` : `<span class="pill">${status}</span>`}</td><td class="ink-4">${at}</td></tr>`).join("")}</tbody></table></div>
    </div>`);
}

function renderSettings(p) {
  const can = manages(p);
  const Y = `<span class="yes">${icon("check", 15)}</span>`; const N = '<span class="no">—</span>'; const A = (t) => `<span class="ask">${t}</span>`;
  const matrix = [
    ["See tickets, pipelines, boards and tasks", Y, Y, Y, Y],
    ["Start Sonic, work tickets, boards and routines", N, Y, Y, A("asks")],
    ["Edit knowledge and skills", N, Y, Y, A("proposes")],
    ["Approve what Sonic wants to do", N, Y, Y, N],
    ["Settings, sources and Sonic's limits", N, N, Y, N],
    ["People and roles", N, N, Y, N],
  ];
  const requests = can ? [["RK", "Developer", "1h"], ["TO", "Viewer", "1d"]] : [];
  return shell(p, "Settings", `
    <div class="bar"><span>${esc(p.name)}</span><span class="ink-5">/</span><span>Settings</span><span class="ink-5">/</span><b>People</b><span style="flex:1"></span>${avatar(ME().code, 28)}</div>
    <div class="content">
      <h1 class="title">Settings</h1><p class="meta">${esc(p.name)}</p>
      <div class="settings">
        <nav class="tabs">${["General", "People", "Sources", "Knowledge and skills", "Sonic", "Templates"].map((t) => `<a class="nav ${t === "People" ? "on" : ""}">${esc(t)}</a>`).join("")}</nav>
        <div style="display:grid;gap:30px;min-width:0">
          ${requests.length ? `<div>
            <h2 class="sub">Requests <span class="num">${requests.length}</span></h2>
            <div class="card" style="border-radius:14px">${requests.map(([code, role, age]) => `<div class="req">${avatar(code, 30)}<div class="what"><div>${PEOPLE[code]}</div><small>${role} · ${age}</small></div><button class="btn sm ghost">Decline</button><button class="btn sm primary">Approve</button></div>`).join("")}</div>
          </div>` : ""}
          <div>
            <h2 class="sub">People <span class="num">${Object.keys(p.members).length}</span><span style="flex:1"></span>${can ? `<button class="btn sm primary">${icon("plus", 14)} Add people</button>` : ""}</h2>
            <div class="card" style="border-radius:16px"><table class="t"><thead><tr><th>Person</th><th style="width:160px">Role</th><th style="width:140px">App role</th><th style="width:100px">Active</th></tr></thead>
            <tbody class="stagger">${Object.entries(p.members).map(([code, role]) => { const u = USERS.find((x) => x.code === code); return `<tr><td><span class="who">${avatar(code, 26)}<span style="font-weight:550">${PEOPLE[code]}</span></span></td>
              <td>${can ? roleSelect(role) : `<span class="ink-3">${role}</span>`}</td><td class="ink-4">${u ? u.app : ""}</td><td class="ink-4">${u ? u.at : ""}</td></tr>`; }).join("")}</tbody></table></div>
          </div>
          <div>
            <h2 class="sub">Roles</h2>
            <div class="card" style="border-radius:16px"><table class="t matrix"><thead><tr><th></th><th style="width:110px">Viewer</th><th style="width:120px">Developer</th><th style="width:110px">Owner</th><th class="sonic" style="width:120px">Sonic</th></tr></thead>
            <tbody>${matrix.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="sonic">${r[4]}</td></tr>`).join("")}</tbody></table></div>
          </div>
        </div>
      </div>
    </div>`);
}

// ---------------------------------------------------------------- count-up, router
function countUp(root = document) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count); const dec = Number(el.dataset.dec || 0); const suffix = el.dataset.suffix || "";
    const fmt = (v) => v.toFixed(dec) + suffix; if (still()) { el.textContent = fmt(target); return; }
    const start = performance.now(); const from = dec ? Math.max(0, target - 6) : 0;
    const step = (now) => { const t = Math.min(1, (now - start) / 650); el.textContent = fmt(from + (target - from) * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(step); };
    el.textContent = fmt(from); requestAnimationFrame(step);
  });
}
function render() {
  const parts = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean);
  const app = $("#app"); let route = "home";
  if (parts[0] === "new") { app.innerHTML = renderNew(); wireNew(); route = "new"; }
  else if (parts[0] === "admin" && isAdmin()) { app.innerHTML = renderAdmin(); wireAdmin(); route = "admin"; }
  else if (parts[0] === "p") {
    const p = byId(parts[1]);
    if (!p || !roleIn(p)) { app.innerHTML = `${topbar()}<main class="paper"><div class="wrap noaccess"><span class="mono">No access</span><h1 class="display">This project isn't shared with you.</h1><a class="btn" href="#/">All projects</a></div></main>`; wireTopbar(); return; }
    if (parts[2] === "settings" && roleIn(p) !== "View only") { app.innerHTML = renderSettings(p); route = "settings"; } else { app.innerHTML = renderProject(p); route = "project"; }
    paintAll(app); $("#switcher").addEventListener("click", () => { switcherOpen = !switcherOpen; render(); });
    $("#request")?.addEventListener("click", (e) => { e.target.textContent = "Requested"; e.target.disabled = true; });
  } else { app.innerHTML = renderHome(); wireHome(); }
  wireTopbar();
  document.querySelectorAll(".dock a").forEach((a) => a.classList.toggle("on", a.dataset.route === route));
  $("#as").textContent = `As ${{ admin: "admin", developer: "developer", viewer: "viewer", new: "new user" }[AS]}`;
  countUp(app);
}
function toggleTheme() { const dark = !isDark(); document.documentElement.dataset.theme = dark ? "dark" : "light"; $("#theme").textContent = dark ? "Light" : "Dark"; render(); }
window.addEventListener("hashchange", () => { switcherOpen = false; menuOpen = false; window.scrollTo(0, 0); render(); });
window.addEventListener("scroll", () => { const top = $("#top"); if (top) top.classList.toggle("scrolled", scrollY > 4); });
$("#theme").addEventListener("click", toggleTheme);
$("#as").addEventListener("click", () => { const order = Object.keys(PERSONAS); AS = order[(order.indexOf(AS) + 1) % order.length]; localStorage.setItem("nc-mock-as", AS); render(); });
window.setAs = (who) => { AS = who; localStorage.setItem("nc-mock-as", AS); render(); };
window.openSwitcher = () => { switcherOpen = true; render(); };
window.openMenu = () => { menuOpen = true; render(); };
render();
