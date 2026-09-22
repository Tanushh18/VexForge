// The live office simulation behind the dashboard.
//
// Every robot follows a human office day — clock in, stand-up, desk work,
// coffee, lunch, meetings, clock out — and works through tasks that walk it
// between departments. Real backend events (drafts, approvals, sends,
// tickets…) arrive through ingestActivity() and become "live" tasks that
// pre-empt simulated work, so what you see on the floor tracks what the
// company is actually doing.
//
// State lives in this module, not in React, so it keeps running while you
// move between pages. Components subscribe() and re-render at their own rate.

export const WORLD = { w: 1860, h: 880, corrY: 410 };
const EXIT = { x: -40, y: WORLD.corrY };
const WALK_PX_PER_MIN = 110; // sim minutes, so walking scales with sim speed

export const ROOMS = {
  exec: { key: "exec", name: "Executive Suite", x: 30, y: 30, w: 250, h: 310, top: true, color: "#ff7a2e", dept: "Executive" },
  ops: { key: "ops", name: "Operations", x: 300, y: 30, w: 290, h: 310, top: true, color: "#ff9c5c", dept: "Operations" },
  product: { key: "product", name: "Product", x: 610, y: 30, w: 290, h: 310, top: true, color: "#b06ff0", dept: "Product" },
  tech: { key: "tech", name: "Tech", x: 920, y: 30, w: 290, h: 310, top: true, color: "#3fb87f", dept: "Tech" },
  conf: { key: "conf", name: "Gavaskar Boardroom", x: 1230, y: 30, w: 260, h: 310, top: true, color: "#8b93a1" },
  m1: { key: "m1", name: "Tendulkar", x: 1510, y: 30, w: 150, h: 310, top: true, color: "#4f8fe0", meeting: true },
  m2: { key: "m2", name: "Dhoni", x: 1680, y: 30, w: 150, h: 310, top: true, color: "#e0c84f", meeting: true },
  hr: { key: "hr", name: "HR", x: 30, y: 480, w: 250, h: 370, top: false, color: "#8f98e6", dept: "HR" },
  fin: { key: "fin", name: "Finance", x: 300, y: 480, w: 290, h: 370, top: false, color: "#e0b04f", dept: "Finance" },
  sup: { key: "sup", name: "Support", x: 610, y: 480, w: 290, h: 370, top: false, color: "#4fb3e0", dept: "Support" },
  cafe: { key: "cafe", name: "Cafeteria", x: 920, y: 480, w: 290, h: 370, top: false, color: "#c98a5a" },
  m3: { key: "m3", name: "Kohli", x: 1230, y: 480, w: 150, h: 370, top: false, color: "#e05a4f", meeting: true },
  m4: { key: "m4", name: "Kapil Dev", x: 1400, y: 480, w: 150, h: 370, top: false, color: "#4fe0a8", meeting: true },
  server: { key: "server", name: "Server Room", x: 1570, y: 480, w: 260, h: 370, top: false, color: "#5fd3c4", server: true },
};
export const SERVER_CONSOLE = { x: 1700, y: 730 };
export const RACKS = [0, 1, 2, 3].map((i) => ({ x: 1610 + i * 60, y: 570 }));
export const TEAM_KEYS = ["ops", "product", "tech", "hr", "fin", "sup"];
export const DEPT_KEY = { Operations: "ops", Product: "product", Tech: "tech", HR: "hr", Finance: "fin", Support: "sup", Executive: "exec" };
export const MIN_WORKERS = 1;
export const MAX_WORKERS = 8;

export const CEO_DESK = { x: 100, y: 135 };
export const EMBER_DESK = { x: 205, y: 135 };
export const COFFEE_MACHINE = { x: 965, y: 530 };
export const FOOD_COUNTER = { x: 1015, y: 790, w: 180, h: 18 };
export const CAFE_TABLES = [995, 1075, 1155].flatMap((x) => [655, 735].map((y) => ({ x, y })));
export const CONF_TABLE = { x: 1360, y: 170, w: 180, h: 64 };
export const MEETING_ROOMS = ["m1", "m2", "m3", "m4"];
export function meetingTable(key) {
  const r = ROOMS[key];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 + (r.top ? 10 : -10), w: 46, h: 140 };
}
function meetingSeats(key) {
  const t = meetingTable(key);
  return [-45, 0, 45].flatMap((dy) => [{ x: t.x - 42, y: t.y + dy }, { x: t.x + 42, y: t.y + dy }]);
}

const CAFE_SEATS = CAFE_TABLES.flatMap((t) => [
  { x: t.x - 30, y: t.y }, { x: t.x + 30, y: t.y }, { x: t.x, y: t.y - 26 }, { x: t.x, y: t.y + 26 },
]);
const COFFEE_SPOTS = Array.from({ length: 8 }, (_, i) => ({ x: 1010 + (i % 4) * 24, y: 548 + Math.floor(i / 4) * 30 }));
const CONF_SEATS = [
  ...[1290, 1340, 1390, 1440].map((x) => ({ x, y: 124 })),
  ...[1290, 1340, 1390, 1440].map((x) => ({ x, y: 222 })),
  { x: 1258, y: 174 }, { x: 1465, y: 174 },
];
const STAFF_SPOTS = [{ x: 965, y: 575 }, { x: 1105, y: 830 }];

const DEFAULT_NAMES = {
  ops: { manager: ["Rhea", "Operations Manager"], workers: [["Scout", "Lead Scout"], ["Rank", "Lead Ranker"], ["Trace", "Enrichment Agent"]] },
  product: { manager: ["Iris", "Product Manager"], workers: [["Quill", "Outreach Drafter"], ["Muse", "Copywriter"], ["Pixel", "Design & Brand Agent"]] },
  tech: { manager: ["Kabir", "Tech Manager"], workers: [["Byte", "Website Ops Agent"], ["Circuit", "Automation Engineer"], ["Vault", "Database Agent"]] },
  hr: { manager: ["Priya", "HR Manager"], workers: [["Sage", "Onboarding Agent"], ["Wren", "Performance Tracker"], ["Juno", "Recruiting Agent"]] },
  fin: { manager: ["Devika", "Finance Manager"], workers: [["Ledger", "Quote Builder"], ["Tally", "Pipeline Value Analyst"], ["Mint", "Invoicing Agent"]] },
  sup: { manager: ["Arjun", "Support Manager"], workers: [["Echo", "Call & Feedback Agent"], ["Relay", "Ticket Resolver"], ["Archive", "Knowledge Base Agent"]] },
};
const SPARE_NAMES = ["Nova", "Orbit", "Bolt", "Kite", "Flux", "Ion", "Zephyr", "Onyx", "Rune", "Sprocket", "Vega", "Cobalt", "Ember-2", "Quartz", "Axel", "Dash", "Gizmo", "Neon", "Pulse", "Rivet", "Spark", "Titan", "Widget", "Cog", "Servo", "Diode", "Helix", "Jolt", "Lumen", "Mica", "Nimbus", "Photon", "Radix", "Sonar"];

// ---------- helpers ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const dayOf = (t = sim.t) => Math.floor(t / 1440);
export const todOf = (t = sim.t) => ((t % 1440) + 1440) % 1440;
export function fmtTime(t) {
  const m = Math.floor(todOf(t));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function dateOf(t = sim.t) {
  const d = new Date(sim.startDate);
  d.setDate(d.getDate() + dayOf(t));
  return d;
}
export function fmtDate(t = sim.t) {
  return dateOf(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function roomAt(p) {
  for (const r of Object.values(ROOMS)) {
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r.key;
  }
  return null;
}
function doorOf(key) {
  const r = ROOMS[key];
  return { x: r.x + r.w / 2, y: r.top ? r.y + r.h - 18 : r.y + 18 };
}
export function managerDesk(key) {
  const r = ROOMS[key];
  return { x: r.x + r.w / 2, y: r.top ? r.y + 72 : r.y + r.h - 72 };
}
export function workerDesks(key, n) {
  const r = ROOMS[key];
  const rowY = r.top ? [r.y + 158, r.y + 234] : [r.y + 92, r.y + 170];
  const perRow = [Math.min(n, 4), Math.max(0, n - 4)];
  const out = [];
  perRow.forEach((k, row) => {
    for (let i = 0; i < k; i++) out.push({ x: r.x + (r.w * (i + 0.5)) / k, y: rowY[row] });
  });
  return out;
}
const seatOf = (desk) => ({ x: desk.x, y: desk.y + 34 });
const visitorOf = (desk, r) => ({ x: desk.x + 30 + (r ? r.lane * 0.4 : 0), y: desk.y + 30 });

// ---------- state ----------
function loadCounts() {
  try {
    const saved = JSON.parse(localStorage.getItem("vf_office_counts") || "null");
    if (saved) return { ...Object.fromEntries(TEAM_KEYS.map((k) => [k, 3])), ...saved };
  } catch { /* storage unavailable */ }
  return Object.fromEntries(TEAM_KEYS.map((k) => [k, 3]));
}

const today = new Date();
today.setHours(0, 0, 0, 0);

export const sim = {
  t: 9 * 60 + 20, // day 0, 09:20
  speed: 1, // sim minutes per real second
  paused: false,
  autoNight: true,
  startDate: today,
  ceoName: "Tanush",
  robots: new Map(),
  queues: { ops: [], product: [], tech: [], hr: [], fin: [], sup: [], exec: [] },
  deptDone: {},
  feed: [],
  toasts: [],
  chats: {},
  counts: loadCounts(),
  names: {},
  seats: { cafe: Array(CAFE_SEATS.length).fill(null), coffee: Array(COFFEE_SPOTS.length).fill(null), conf: Array(CONF_SEATS.length).fill(null) },
  meetings: {},
  pulse: null,            // latest /api/company/pulse snapshot
  incidents: new Map(),   // key -> live incident being worked
  requests: [],           // open intern/hiring requests from managers
  alerts: [],             // things a robot has brought to the CEO's desk
  deskVisitor: null,      // robot currently standing at your desk
  announcement: null,     // all-hands broadcast
  interns: new Set(),
  pendingApprovals: 0,
  backend: {}, // real Employee docs keyed by name
  seenActivity: new Set(),
  version: 0, // bumps when the roster/desks change
  history: [],  // one compact frame per sim minute, for the replay scrubber
  restored: false,
};
const HISTORY_MINUTES = 900;

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn());
}

let feedSeq = 1;
export function event(text, { dept, live = false, robot } = {}) {
  const item = { id: feedSeq++, t: sim.t, text, dept, live, robotId: robot?.id };
  sim.feed.unshift(item);
  if (sim.feed.length > 400) sim.feed.length = 400;
  if (live) toast(text);
}
export function toast(text) {
  sim.toasts.push({ id: feedSeq++, text, at: performance.now() });
  if (sim.toasts.length > 6) sim.toasts.shift();
}
function rlog(r, text) {
  r.log.unshift({ t: sim.t, text });
  if (r.log.length > 200) r.log.length = 200;
}

// ---------- roster ----------
function makeRobot({ id, role, room, index }) {
  const h = hash(id);
  const joined = new Date(2021 + (h % 5), (h >>> 5) % 12, 1 + ((h >>> 9) % 28));
  return {
    id, role, room, index,
    name: "", title: "",
    color: ROOMS[room].color,
    desk: { x: 0, y: 0 },
    pos: { ...EXIT }, path: [], dir: 1,
    goalKey: null, goalLabel: "", arrived: false,
    visible: false, mode: "init",
    activity: "Off duty — at home",
    task: null, idleMins: 0, waitMins: 0,
    meetingWith: null,
    log: [],
    lane: ((h % 9) - 4) * 6,
    energy: 100, coffees: 0, doneToday: 0, doneTotal: 0,
    mood: "ok", stress: 20, chatUntil: null, chatWith: null, loadMins: 0, isIntern: false,
    attendance: {},
    birthday: { m: (h >>> 13) % 12, d: 1 + ((h >>> 17) % 28) },
    joined,
    sched: {},
    seat: null,
    removing: false,
  };
}

function workerName(dept, i) {
  const n = sim.names[dept]?.workers?.[i] || DEFAULT_NAMES[dept].workers[i];
  if (n) return n;
  const used = new Set([...sim.robots.values()].map((r) => r.name));
  const spare = SPARE_NAMES.find((s) => !used.has(s)) || `Unit-${dept}-${i}`;
  return [spare, "Associate Agent"];
}

function syncRoster(initial) {
  const wanted = [];
  wanted.push({ id: "ember", role: "head", room: "exec", index: 0, name: ["Ember", "Head Manager (Chief of Staff)"], desk: EMBER_DESK });
  for (const dept of TEAM_KEYS) {
    const m = sim.names[dept]?.manager || DEFAULT_NAMES[dept].manager;
    wanted.push({ id: `${dept}-m`, role: "manager", room: dept, index: 0, name: m, desk: managerDesk(dept) });
    const desks = workerDesks(dept, sim.counts[dept]);
    for (let i = 0; i < sim.counts[dept]; i++) {
      wanted.push({ id: `${dept}-w${i}`, role: "worker", room: dept, index: i, name: workerName(dept, i), desk: desks[i] });
    }
  }
  wanted.push({ id: "cafe-0", role: "staff", room: "cafe", index: 0, name: ["Olive", "Barista"], desk: STAFF_SPOTS[0] });
  wanted.push({ id: "cafe-1", role: "staff", room: "cafe", index: 1, name: ["Basil", "Head Chef"], desk: STAFF_SPOTS[1] });

  const wantedIds = new Set(wanted.map((w) => w.id));
  for (const w of wanted) {
    let r = sim.robots.get(w.id);
    const isNew = !r || r.removing;
    if (!r) {
      r = makeRobot(w);
      sim.robots.set(w.id, r);
    }
    r.removing = false;
    r.isIntern = sim.interns.has(w.id);
    r.name = w.name[0];
    r.title = r.isIntern ? `${w.name[1]} (Intern)` : w.name[1];
    r.desk = w.desk;
    if (isNew && !initial) {
      rlog(r, "First day at VexForge — welcome aboard!");
      event(`🤖 ${r.name} joined ${ROOMS[r.room].name} as ${r.title}`, { dept: r.room, robot: r });
    }
  }
  for (const r of sim.robots.values()) {
    if (wantedIds.has(r.id) || r.removing) continue;
    r.removing = true;
    if (r.task) { sim.queues[r.room].unshift(r.task); r.task = null; }
    rlog(r, "Reassigned out of the team — packing up");
    event(`📦 ${r.name} is leaving ${ROOMS[r.room].name}`, { dept: r.room, robot: r });
    if (!r.visible) sim.robots.delete(r.id);
  }

  // Demo-friendly fixtures so HR always has something to celebrate.
  const d = dateOf();
  const bday = sim.robots.get("ops-w1");
  if (bday) bday.birthday = { m: d.getMonth(), d: d.getDate() };
  const anniv = sim.robots.get("tech-w0");
  if (anniv) anniv.joined = new Date(d.getFullYear() - 2, d.getMonth(), d.getDate());

  sim.version++;
}

export function setCount(dept, n) {
  sim.counts[dept] = clamp(n, MIN_WORKERS, MAX_WORKERS);
  try { localStorage.setItem("vf_office_counts", JSON.stringify(sim.counts)); } catch { /* ignore */ }
  syncRoster(false);
  emit();
}

// Real names/titles from the org chart, so the office matches the CRM.
export function applyOrgTree(root) {
  if (!root) return;
  const all = [];
  (function walk(n) { all.push(n); (n.reports || []).forEach(walk); })(root);
  sim.backend = Object.fromEntries(all.map((e) => [e.name, e]));
  for (const dept of TEAM_KEYS) {
    const people = all.filter((e) => DEPT_KEY[e.department] === dept);
    const mgr = people.find((e) => e.level === "manager");
    const agents = people.filter((e) => e.level === "agent");
    // Keep the default front-line trio first (Quill handles email), then the rest.
    const order = DEFAULT_NAMES[dept].workers.map(([n]) => n);
    agents.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
    sim.names[dept] = {
      manager: mgr ? [mgr.name, mgr.title] : DEFAULT_NAMES[dept].manager,
      workers: agents.map((a) => [a.name, a.title]),
    };
  }
  syncRoster(sim.robots.size === 0);
}

// ---------- schedule ----------
export function schedule(r, day = dayOf()) {
  if (r.sched[day]) return r.sched[day];
  const R = rng(`${r.id}:${day}`);
  const j = (n) => Math.floor(R() * n);
  let s;
  if (r.role === "staff") {
    s = { arrive: 465 + j(12), leave: 1110 + j(12), lunch: [900, 930], coffee: [] };
  } else if (r.role === "head") {
    const c = 610 + j(40);
    s = { arrive: 490 + j(15), leave: 1095 + j(20), lunch: [765, 805], coffee: [[c, c + 12], [945, 957]] };
  } else if (r.role === "manager") {
    const c1 = 600 + j(60), c2 = 930 + j(45);
    s = { arrive: 500 + j(25), leave: 1080 + j(30), lunch: [780, 820], coffee: [[c1, c1 + 12], [c2, c2 + 10]] };
  } else {
    const c1 = 605 + j(70), c2 = 920 + j(60);
    s = {
      arrive: 505 + j(40),
      leave: 1055 + j(55),
      lunch: r.index % 2 ? [795, 835] : [750, 790],
      coffee: [[c1, c1 + 10 + j(6)], [c2, c2 + 10]],
    };
  }
  r.sched = { [day]: s };
  return s;
}
const within = (tod, [a, b]) => tod >= a && tod < b;

function desiredMode(r) {
  const tod = todOf();
  const s = schedule(r);
  if (r.removing) return "home";
  if (tod < s.arrive || tod >= s.leave) return "home";
  if (within(tod, s.lunch)) return "lunch";
  // Urgent work from the CEO pulls a robot out of coffee or a stand-up.
  if (announcementActive() && r.role !== "staff") return "allhands";
  if (r.task?.live) return "work";
  if (meetingOf(r, tod)) return "meeting";
  if (s.coffee.some((c) => within(tod, c))) return "coffee";
  if ((r.role === "worker" || r.role === "manager") && tod >= 570 && tod < 585) return "standup";
  if ((r.role === "manager" || r.role === "head") && tod >= 690 && tod < 720) return "sync";
  return "work";
}

export const MODE_LABEL = {
  init: "—", home: "Off duty", work: "Working", lunch: "Lunch break", coffee: "Coffee break",
  standup: "Stand-up", sync: "Managers' sync", meeting: "Meeting", allhands: "All-hands",
};

// ---------- meetings (cricketer rooms) ----------
const MEETING_DEFS = [
  ["ops", "fin", "Quote review for hot leads"], ["ops", "tech", "Scraper reliability sync"], ["hr", "fin", "Payroll & headcount check"],
  ["sup", "tech", "Bug triage"], ["ops", "sup", "Customer hand-off review"], ["tech", "hr", "Onboarding tooling"],
  ["fin", "sup", "Billing issues review"], ["hr", "ops", "Hiring plan for Operations"], ["tech", "fin", "Cloud cost review"],
];
const MEETING_SLOTS = [600, 640, 870, 910, 950, 990];

export function meetingsFor(day = dayOf()) {
  if (sim.meetings[day]) return sim.meetings[day];
  const R = rng(`meet:${day}`);
  const busy = {};
  const list = [];
  for (const room of MEETING_ROOMS) {
    const slots = [...MEETING_SLOTS].sort(() => R() - 0.5).slice(0, 2).sort((a, b) => a - b);
    for (const start of slots) {
      const [a, b, title] = MEETING_DEFS[Math.floor(R() * MEETING_DEFS.length)];
      const end = start + (R() < 0.5 ? 25 : 30);
      const pickW = (d) => `${d}-w${Math.floor(R() * sim.counts[d])}`;
      const ids = [...new Set([`${a}-m`, pickW(a), pickW(b), R() < 0.6 ? `${b}-m` : pickW(b)])]
        .filter((id) => !(busy[id] || []).some(([s, e]) => start < e && end > s));
      ids.forEach((id) => (busy[id] ||= []).push([start, end]));
      if (ids.length >= 2) list.push({ id: `${day}-${room}-${start}`, room, start, end, title, attendees: ids, teams: [a, b] });
    }
  }
  sim.meetings = { [day]: list.sort((x, y) => x.start - y.start) };
  return sim.meetings[day];
}
export function meetingOf(r, tod = todOf()) {
  return meetingsFor().find((m) => m.attendees.includes(r.id) && tod >= m.start && tod < m.end);
}

// ---------- movement ----------
function route(r, pt, room) {
  const from = roomAt(r.pos);
  const y = WORLD.corrY + r.lane;
  const pts = [];
  if (from !== room || room == null) {
    if (from) {
      const d = doorOf(from);
      pts.push({ x: d.x, y: d.y }, { x: d.x, y });
    } else {
      pts.push({ x: r.pos.x, y });
    }
    if (room) {
      const d = doorOf(room);
      pts.push({ x: d.x, y }, { x: d.x, y: d.y });
    }
  }
  pts.push({ ...pt });
  return pts;
}

function setGoal(r, key, pt, room, label, teleport) {
  if (r.goalKey === key) return;
  r.goalKey = key;
  r.goalLabel = label;
  r.arrived = false;
  if (teleport) {
    r.pos = { ...pt };
    r.path = [];
    r.arrived = true;
    return;
  }
  r.path = route(r, pt, room);
}

function move(r, dist) {
  while (dist > 0 && r.path.length) {
    const p = r.path[0];
    const dx = p.x - r.pos.x, dy = p.y - r.pos.y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.5) r.dir = dx < 0 ? -1 : 1;
    if (d <= dist) {
      r.pos.x = p.x; r.pos.y = p.y; dist -= d; r.path.shift();
    } else {
      r.pos.x += (dx / d) * dist; r.pos.y += (dy / d) * dist; dist = 0;
    }
  }
  if (!r.path.length && !r.arrived && r.goalKey) {
    r.arrived = true;
    onArrive(r);
  }
}

function onArrive(r) {
  if (r.mode === "home") {
    r.visible = false;
    const a = (r.attendance[dayOf()] ||= {});
    a.out = sim.t;
    rlog(r, "Clocked out and went home");
    if (r.removing) sim.robots.delete(r.id);
  }
}

// ---------- seats ----------
function alloc(kind, r) {
  const arr = sim.seats[kind];
  const start = Math.abs(r.lane) % arr.length;
  for (let k = 0; k < arr.length; k++) {
    const i = (start + k) % arr.length;
    if (!arr[i]) { arr[i] = r.id; r.seat = { kind, i }; return i; }
  }
  return -1;
}
function release(r) {
  if (r.seat) sim.seats[r.seat.kind][r.seat.i] = null;
  r.seat = null;
}

// ---------- modes ----------
function enterMode(r, mode, teleport = false) {
  const prev = r.mode;
  release(r);
  r.mode = mode;
  r.goalKey = null;
  const day = dayOf();
  const s = schedule(r);

  if ((prev === "home" || prev === "init") && mode !== "home") {
    r.visible = true;
    r.energy = 100;
    r.coffees = 0;
    const a = (r.attendance[day] ||= {});
    a.in = teleport ? day * 1440 + s.arrive : sim.t;
    if (!teleport) {
      r.pos = { x: EXIT.x, y: WORLD.corrY + r.lane };
      rlog(r, "Clocked in at the front door");
      event(`🟢 ${r.name} clocked in`, { dept: r.room, robot: r });
    } else {
      rlog(r, "At the office");
    }
  }

  switch (mode) {
    case "home": {
      if (prev === "init") {
        r.visible = false;
        r.pos = { ...EXIT };
        if (todOf() >= s.leave) r.attendance[day] = { in: day * 1440 + s.arrive, out: day * 1440 + s.leave };
        r.activity = "Off duty — at home";
        return;
      }
      if (!r.visible) return;
      r.activity = "Heading home";
      setGoal(r, "home", { x: EXIT.x, y: WORLD.corrY + r.lane }, null, r.removing ? "Leaving the company" : "Heading home for the day");
      if (!r.removing) {
        rlog(r, "Wrapped up for the day");
        event(`🔴 ${r.name} left for the day`, { dept: r.room, robot: r });
      }
      return;
    }
    case "lunch": {
      const i = alloc("cafe", r);
      const pt = i >= 0 ? CAFE_SEATS[i] : { x: 1320 + r.lane, y: 780 };
      r.activity = pick(["Having lunch — paneer wrap 🌯", "Having lunch — pasta 🍝", "Having lunch — dal & rice 🍛", "Having lunch — salad bowl 🥗", "Having lunch — noodles 🍜"]);
      setGoal(r, "lunch", pt, "cafe", "Walking to the cafeteria for lunch", teleport);
      rlog(r, "Lunch break");
      return;
    }
    case "coffee": {
      const i = alloc("coffee", r);
      const pt = i >= 0 ? COFFEE_SPOTS[i] : { x: 1210 + r.lane, y: 600 };
      r.coffees += 1;
      r.activity = pick(["Coffee break ☕ — chatting by the machine", "Coffee break ☕ — cappuccino", "Tea break 🍵 — masala chai", "Coffee break ☕ — cold brew"]);
      setGoal(r, "coffee", pt, "cafe", "Walking to the cafeteria for a coffee", teleport);
      rlog(r, "Coffee break");
      return;
    }
    case "standup": {
      const mgr = sim.robots.get(`${r.room}-m`);
      if (r.role === "manager") {
        r.activity = "Running the daily stand-up";
        setGoal(r, `desk:${r.id}:${r.desk.x}`, seatOf(r.desk), r.room, "Back to desk for stand-up", teleport);
      } else {
        const md = managerDesk(r.room);
        const room = ROOMS[r.room];
        const pt = { x: md.x - 66 + (r.index % 4) * 44, y: md.y + (room.top ? 58 : -46) + Math.floor(r.index / 4) * 16 };
        r.activity = `Daily stand-up with ${mgr?.name || "the manager"} — sharing progress`;
        setGoal(r, "standup", pt, r.room, "Joining the daily stand-up", teleport);
      }
      rlog(r, "Daily stand-up");
      return;
    }
    case "sync": {
      const i = alloc("conf", r);
      const pt = CONF_SEATS[Math.max(0, i)];
      r.activity = r.role === "head" ? "Chairing the managers' sync" : `Managers' sync — reporting ${ROOMS[r.room].name} status to Ember`;
      setGoal(r, "sync", pt, "conf", "Walking to the conference room", teleport);
      rlog(r, "Managers' sync in the conference room");
      return;
    }
    case "allhands": {
      const a = sim.announcement;
      const i = alloc("conf", r);
      const pt = i >= 0 ? CONF_SEATS[i] : { x: CONF_TABLE.x + r.lane * 2, y: CONF_TABLE.y + 90 };
      r.activity = `All-hands — listening to ${sim.ceoName}: "${a?.text || ""}"`;
      setGoal(r, "allhands", pt, "conf", "Heading to the all-hands in the Gavaskar Boardroom", teleport);
      rlog(r, `All-hands called by ${sim.ceoName}: "${a?.text || ""}"`);
      return;
    }
    case "meeting": {
      const m = meetingOf(r);
      const idx = m.attendees.indexOf(r.id);
      const pt = meetingSeats(m.room)[idx % 6];
      const others = m.attendees.filter((id) => id !== r.id).map((id) => sim.robots.get(id)?.name).filter(Boolean);
      r.activity = `In "${m.title}" — ${ROOMS[m.room].name} room, with ${others.join(", ")} (until ${fmtTime(m.end)})`;
      setGoal(r, `meeting:${m.id}`, pt, m.room, `Walking to the ${ROOMS[m.room].name} room for "${m.title}"`, teleport);
      rlog(r, `Meeting: "${m.title}" in ${ROOMS[m.room].name}`);
      return;
    }
    case "work": {
      if (prev === "lunch" || prev === "meeting" || prev === "coffee" || prev === "standup" || prev === "sync") rlog(r, "Back to work");
      r.activity = "Settling in at the desk";
      if (teleport) setGoal(r, `desk:${r.id}:${r.desk.x}`, seatOf(r.desk), r.room, "", true);
      return;
    }
  }
}

// ---------- tasks ----------
const S = (where, label, dur) => ({ where, label, dur });
const CATALOG = {
  ops: [
    { title: "Score the overnight lead batch", steps: [S("self", "Scoring new leads against the ICP", 30)] },
    { title: "Hand a hot lead to Finance", steps: [S("self", "Writing a lead brief", 12), S({ dept: "fin", who: "manager" }, "Walking {p} through the lead for a quote", 12), S("self", "Updating the CRM with quote status", 8)] },
    { title: "Investigate scraper failures", steps: [S({ dept: "tech", who: "any" }, "Debugging scraper errors with {p}", 18), S("self", "Re-running the failed discovery source", 12)] },
    { title: "Draft follow-up emails", steps: [S("self", "Drafting follow-ups for quiet leads", 25), S("ember", "Getting tone sign-off from {p}", 6)] },
    { title: "Clean duplicate CRM records", steps: [S("self", "Merging duplicate lead records", 20)] },
  ],
  tech: [
    { title: "Deploy console update", steps: [S("self", "Running the build & test suite", 25), S("self", "Deploying to Render", 10), S({ dept: "ops", who: "manager" }, "Demoing the new release to {p}", 10)] },
    { title: "Fix scraper timeout bug", steps: [S("self", "Patching Playwright timeout handling", 30), S({ dept: "ops", who: "any" }, "Verifying the fix with {p}", 10)] },
    { title: "Tune database indexes", steps: [S("self", "Analysing slow MongoDB queries", 25)] },
    { title: "Provision laptop for a new hire", steps: [S("self", "Imaging a new workstation", 15), S({ dept: "hr", who: "manager" }, "Handing laptop credentials to {p}", 6)] },
    { title: "Monitor model API quota", steps: [S("self", "Checking Groq rate-limit headroom", 12), S({ dept: "fin", who: "any" }, "Sharing usage numbers with {p}", 8)] },
  ],
  product: [
    { title: "Rewrite a cold-email template", steps: [S("self", "Rewriting the cold-email template", 25), S("ember", "Getting tone sign-off from {p}", 6)] },
    { title: "Design an email header", steps: [S("self", "Designing a new email header", 22)] },
    { title: "Review reply rates by message", steps: [S({ dept: "ops", who: "any" }, "Pulling reply stats with {p}", 10), S("self", "Rewriting the weakest variant", 20)] },
    { title: "Refresh the pitch one-pager", steps: [S("self", "Refreshing the pitch one-pager", 25), S("ceo", "Showing the new pitch to {ceo}", 5)] },
    { title: "A/B test subject lines", steps: [S("self", "Drafting subject-line variants", 18), S({ dept: "fin", who: "any" }, "Checking send budget with {p}", 6)] },
  ],
  hr: [
    { title: "Collect weekly timesheets", steps: [S({ dept: "ops", who: "any" }, "Collecting a timesheet from {p}", 6), S({ dept: "tech", who: "any" }, "Collecting a timesheet from {p}", 6), S({ dept: "sup", who: "any" }, "Collecting a timesheet from {p}", 6), S("self", "Compiling timesheets", 12)] },
    { title: "Plan a birthday celebration", steps: [S("self", "Planning the team birthday celebration", 12), S("cafe", "Ordering a cake from {p}", 6)] },
    { title: "Draft onboarding checklist", steps: [S("self", "Writing the onboarding checklist", 25)] },
    { title: "Monthly attendance report", steps: [S("self", "Compiling the attendance report", 20), S("ember", "Presenting the attendance report to {p}", 8)] },
    { title: "Update leave policy", steps: [S("self", "Revising the leave policy", 20), S("ceo", "Getting the policy approved by {ceo}", 4)] },
  ],
  fin: [
    { title: "Build a quote for a lead", steps: [S({ dept: "ops", who: "any" }, "Gathering requirements from {p}", 10), S("self", "Building the quote spreadsheet", 25)] },
    { title: "Reconcile API costs", steps: [S({ dept: "tech", who: "any" }, "Reviewing API invoices with {p}", 12), S("self", "Reconciling monthly costs", 18)] },
    { title: "Run payroll", steps: [S({ dept: "hr", who: "manager" }, "Confirming headcount with {p}", 10), S("self", "Running payroll", 25), S("ceo", "Getting payroll signed by {ceo}", 4)] },
    { title: "Forecast pipeline value", steps: [S("self", "Forecasting pipeline revenue", 30)] },
  ],
  sup: [
    { title: "Resolve a customer ticket", steps: [S("self", "Resolving a customer ticket", 22)] },
    { title: "Escalate a bug to Tech", steps: [S("self", "Reproducing the reported bug", 12), S({ dept: "tech", who: "manager" }, "Escalating the bug to {p}", 10)] },
    { title: "Customer onboarding call", steps: [S("self", "On a customer onboarding call 📞", 25)] },
    { title: "Update help-center articles", steps: [S("self", "Updating help-center articles", 28)] },
  ],
};

let taskSeq = 1;
function newTask(dept, def, extra = {}) {
  return {
    id: taskSeq++, dept, title: def.title, live: false, createdAt: sim.t, assignedTo: null,
    steps: def.steps.map((s) => ({ ...s, done: 0, partnerId: null })), i: 0, ...extra,
  };
}

export function createTask(dept, title, { live = false, steps } = {}) {
  const task = newTask(dept, { title, steps: steps || [S("self", title, 25)] }, { live });
  sim.queues[dept].push(task);
  return task;
}

function assign(r, task, by) {
  r.task = task;
  task.assignedTo = r.id;
  r.idleMins = 0;
  r.goalKey = null;
  rlog(r, `New task${by ? ` from ${by.name}` : ""}: "${task.title}"`);
  if (by) rlog(by, `Assigned "${task.title}" to ${r.name}`);
  event(`${task.live ? "⚡ " : ""}${by ? `${by.name} assigned` : `${r.name} picked up`} "${task.title}"${by ? ` to ${r.name}` : ""}`, { dept: r.room, robot: r });
}

const inOffice = (r) => r.visible && !r.removing && r.mode === "work";

function addLiveTask(dept, task, prefer) {
  const q = sim.queues[dept];
  const workers = [...sim.robots.values()].filter((r) => r.room === dept && (dept === "exec" ? r.role === "head" : r.role === "worker"));
  const avail = workers.filter((r) => r.visible && !r.removing && ["work", "standup", "coffee", "sync"].includes(r.mode));
  avail.sort((a, b) => (a.mode === "work" ? 0 : 1) - (b.mode === "work" ? 0 : 1));
  const chosen = avail.find((r) => r.name === prefer && !r.task?.live) || avail.find((r) => !r.task) || avail.find((r) => !r.task?.live);
  if (chosen) {
    if (chosen.task) {
      q.unshift(chosen.task);
      chosen.task.assignedTo = null;
      rlog(chosen, `Paused "${chosen.task.title}" for urgent work`);
      chosen.task = null;
    }
    assign(chosen, task, dept === "exec" ? null : sim.robots.get(`${dept}-m`));
    return chosen;
  }
  q.unshift(task);
  event(`⏳ "${task.title}" queued — nobody from ${ROOMS[dept].name} is at their desk right now`, { dept, live: true });
  return null;
}

function resolveStep(r, step) {
  const w = step.where;
  if (w === "self") {
    return { key: `desk:${r.id}:${r.desk.x}`, pt: seatOf(r.desk), room: r.room, partner: null, place: "desk" };
  }
  if (w === "server") {
    return { key: "server", pt: { x: SERVER_CONSOLE.x + r.lane * 0.5, y: SERVER_CONSOLE.y }, room: "server", partner: null, place: "the server room" };
  }
  if (w === "ceo") {
    return { key: "ceo", pt: { x: CEO_DESK.x + r.lane * 0.6, y: CEO_DESK.y + 52 }, room: "exec", partner: null, place: `${sim.ceoName}'s desk`, human: true };
  }
  let partner = null;
  if (w === "ember") partner = sim.robots.get("ember");
  else if (w === "cafe") partner = sim.robots.get("cafe-1");
  else if (w.who === "manager") partner = sim.robots.get(`${w.dept}-m`);
  else {
    partner = step.partnerId && sim.robots.get(step.partnerId);
    if (!partner || partner.removing) {
      const pool = [...sim.robots.values()].filter((p) => p.room === w.dept && p.role === "worker" && p.id !== r.id && !p.removing);
      partner = pool.find(inOffice) || pool[0] || sim.robots.get(`${w.dept}-m`);
      step.partnerId = partner?.id;
    }
  }
  if (!partner) return resolveStep(r, { where: "self" });
  const pt = partner.role === "staff" ? { x: 1250 + r.lane * 0.5, y: 770 } : visitorOf(partner.desk, r);
  return { key: `visit:${partner.id}:${partner.desk.x}`, pt, room: partner.room, partner, place: `${partner.name}'s desk` };
}

function stepLabel(step, partner) {
  return step.label.replace("{p}", partner?.name || "").replace("{ceo}", sim.ceoName);
}

function atDesk(p) {
  const s = p.role === "staff" ? p.desk : seatOf(p.desk);
  return p.visible && !p.path.length && Math.hypot(p.pos.x - s.x, p.pos.y - s.y) < 10;
}

function doTask(r) {
  const task = r.task;
  const step = task.steps[task.i];
  const tgt = resolveStep(r, step);
  const label = stepLabel(step, tgt.partner);
  if (r.goalKey !== tgt.key) {
    setGoal(r, tgt.key, tgt.pt, tgt.room, `Heading to ${tgt.place}${tgt.room !== r.room ? ` (${ROOMS[tgt.room].name})` : ""} — ${label}`);
    rlog(r, `Walking to ${tgt.place} for: ${label}`);
    r.activity = label;
    return;
  }
  if (!r.arrived) return;
  if (r.meetingWith && r.meetingWith.until >= sim.t && tgt.place === "desk") {
    r.activity = `Discussing "${r.meetingWith.topic}" with ${r.meetingWith.name} (own work paused)`;
    return;
  }
  const p = tgt.partner;
  if (p && !(atDesk(p) && p.mode === "work")) {
    r.waitMins += 1;
    const why = !p.visible ? "not in the office" : p.mode !== "work" ? `on ${MODE_LABEL[p.mode].toLowerCase()}` : "away from their desk";
    r.activity = `Waiting at ${p.name}'s desk — ${p.name} is ${why} (${r.waitMins} min)`;
    if (r.waitMins >= 20) {
      rlog(r, `Left a note for ${p.name} (unavailable) and moved on`);
      advanceStep(r);
    }
    return;
  }
  r.waitMins = 0;
  if (tgt.human) {
    // Standing at your desk — the dashboard shows a card with the actions.
    sim.deskVisitor = { robotId: r.id, name: r.name, title: r.title, dept: r.room, label, task: task.title, kind: task.kind || "update", entityId: task.entityId, incidentKey: task.incidentKey };
  }
  if (p) p.meetingWith = { name: r.name, topic: task.title, until: sim.t + 1 };
  step.done += 1;
  r.activity = `${label} (${Math.min(step.done, step.dur)}/${step.dur} min)`;
  r.energy -= 0.12;
  if (step.done >= step.dur) advanceStep(r);
}

function advanceStep(r) {
  const task = r.task;
  const step = task.steps[task.i];
  if (sim.deskVisitor?.robotId === r.id) sim.deskVisitor = null;
  rlog(r, `✓ ${stepLabel(step, step.partnerId && sim.robots.get(step.partnerId))}`);
  r.waitMins = 0;
  task.i += 1;
  if (task.i >= task.steps.length) completeTask(r);
}

function completeTask(r) {
  const task = r.task;
  r.task = null;
  r.idleMins = 0;
  r.goalKey = null;
  r.doneToday += 1;
  r.doneTotal += 1;
  sim.deptDone[r.room] = (sim.deptDone[r.room] || 0) + 1;
  rlog(r, `Completed "${task.title}"`);
  const msg = task.doneText ? task.doneText(r) : `✅ ${r.name} completed "${task.title}"`;
  event(msg, { dept: r.room, live: task.live, robot: r });
}

const IDLE = {
  worker: ["Clearing the inbox", "Reviewing documentation", "Tidying up notes from the last task", "Waiting for the next assignment", "Pairing notes into the team wiki"],
  manager: ["Reviewing the team's output", "Planning tomorrow's priorities", "Writing 1:1 notes", "Updating the department dashboard", "Checking the task board"],
  head: ["Reviewing company dashboards", "Preparing the CEO briefing", "Checking department KPIs", "Prioritising the cross-team backlog"],
};

function idleAtDesk(r) {
  setGoal(r, `desk:${r.id}:${r.desk.x}`, seatOf(r.desk), r.room, "Heading back to desk");
  if (!r.arrived) return;
  if (r.meetingWith && r.meetingWith.until >= sim.t) {
    r.activity = `Discussing "${r.meetingWith.topic}" with ${r.meetingWith.name}`;
    return;
  }
  if (r.chatUntil && r.chatUntil >= sim.t) {
    r.activity = `Replying to ${sim.ceoName} on chat 💬`;
    return;
  }
  const list = IDLE[r.role] || IDLE.worker;
  r.activity = list[(Math.floor(sim.t / 25) + r.index + Math.abs(r.lane)) % list.length];
  r.energy -= 0.04;
}

function staffWork(r) {
  setGoal(r, `station:${r.id}`, r.desk, "cafe", "Walking to the station");
  if (!r.arrived) return;
  const tod = todOf();
  const all = [...sim.robots.values()];
  if (r.index === 0) {
    const guest = all.find((g) => g.mode === "coffee" && g.arrived);
    r.activity = guest
      ? `Making a ${pick(["cappuccino", "flat white", "masala chai", "cold brew", "latte"])} for ${guest.name}`
      : ["Cleaning the espresso machine", "Restocking cups & milk", "Grinding fresh beans", "Wiping down the coffee bar"][Math.floor(sim.t / 20) % 4];
  } else {
    const guest = all.find((g) => g.mode === "lunch" && g.arrived);
    if (tod < 720) r.activity = "Preparing lunch — today's special: veg biryani & raita";
    else if (guest) r.activity = `Serving lunch to ${guest.name}`;
    else if (tod < 900) r.activity = "Cleaning the kitchen after lunch";
    else r.activity = "Prepping evening snacks";
  }
}

function work(r) {
  if (r.role === "staff") return staffWork(r);
  if (r.role === "manager") {
    const q = sim.queues[r.room];
    if (q.length) {
      const idle = [...sim.robots.values()].find((w) => w.room === r.room && w.role === "worker" && inOffice(w) && !w.task && w.arrived);
      if (idle) {
        const task = q.shift();
        assign(idle, task, r);
      }
    }
  }
  if (r.role === "head" && !r.task && sim.queues.exec.length) assign(r, sim.queues.exec.shift(), null);
  if (r.role === "worker" && !r.task) {
    const liveIdx = sim.queues[r.room].findIndex((t) => t.live);
    if (liveIdx >= 0) assign(r, sim.queues[r.room].splice(liveIdx, 1)[0], null);
  }
  if (r.role === "worker" && !r.task) {
    r.idleMins += 1;
    const mgr = sim.robots.get(`${r.room}-m`);
    if (r.idleMins >= 12 && sim.queues[r.room].length && !(mgr && inOffice(mgr))) assign(r, sim.queues[r.room].shift(), null);
  }
  if (r.task) doTask(r);
  else idleAtDesk(r);
}

// ---------- clock ----------
function minuteTick() {
  const tod = todOf();
  if (tod === 0) {
    for (const r of sim.robots.values()) { r.doneToday = 0; }
    sim.deptDone = {};
    event(`📅 New day — ${fmtDate()}`);
  }
  corridorChats();
  for (const r of [...sim.robots.values()]) {
    if (r.chatUntil && r.chatUntil < sim.t) { r.chatUntil = null; r.chatWith = null; }
    const want = desiredMode(r);
    if (want !== r.mode) enterMode(r, want);
    if (!r.visible) continue;
    if (r.mode === "work") work(r);
    else if (r.mode === "coffee" && r.arrived) r.energy += 2.5;
    else if (r.mode === "lunch" && r.arrived) r.energy += 1.8;
    r.energy = clamp(r.energy, 5, 100);
    updateMood(r);
    if (r.role === "manager" && r.mode === "work") maybeRequestIntern(r);
    if (r.meetingWith && r.meetingWith.until < sim.t) r.meetingWith = null;
  }
  if (sim.deskVisitor && !sim.robots.get(sim.deskVisitor.robotId)?.task) sim.deskVisitor = null;
  for (const m of meetingsFor()) {
    if (m.start === tod) event(`📅 "${m.title}" started in the ${ROOMS[m.room].name} room`, { dept: m.teams[0] });
  }
  // One compact frame per minute so the day can be replayed.
  sim.history.push({
    t: Math.floor(sim.t),
    robots: [...sim.robots.values()].filter((r) => r.visible).map((r) => ({
      id: r.id, x: Math.round(r.pos.x), y: Math.round(r.pos.y), m: r.mode, mood: r.mood,
      a: r.activity, w: r.path.length > 0 ? 1 : 0, live: r.task?.live ? 1 : 0,
    })),
    stats: { here: [...sim.robots.values()].filter((r) => r.visible).length, done: Object.values(sim.deptDone).reduce((a, b) => a + b, 0), incidents: sim.incidents.size },
  });
  if (sim.history.length > HISTORY_MINUTES) sim.history.shift();

  // Departments generate their own work through the day.
  if (tod >= 585 && tod < 1020) {
    for (const dept of TEAM_KEYS) {
      if (sim.queues[dept].length < 2 && Math.random() < 0.05) {
        const t = newTask(dept, pick(CATALOG[dept]));
        sim.queues[dept].push(t);
      }
    }
  }
}

// ---------- load, morale & hiring ----------
export function teamLoad(dept) {
  const workers = [...sim.robots.values()].filter((r) => r.room === dept && r.role === "worker" && r.visible);
  const busy = workers.filter((r) => r.task).length;
  const queue = (sim.queues[dept] || []).length;
  const incidents = [...sim.incidents.values()].filter((i) => i.team === dept).length;
  const capacity = Math.max(1, workers.length);
  return { workers: workers.length, busy, queue, incidents, pct: Math.min(200, Math.round(((busy + queue + incidents) / capacity) * 100)) };
}

export const MOODS = {
  happy: { emoji: "😄", label: "Happy" }, ok: { emoji: "🙂", label: "Fine" },
  tired: { emoji: "😪", label: "Tired" }, stressed: { emoji: "😰", label: "Stressed" },
  proud: { emoji: "🤩", label: "Proud" },
};
function updateMood(r) {
  const load = TEAM_KEYS.includes(r.room) ? teamLoad(r.room).pct : 60;
  const stress = clamp((load - 70) * 0.6 + (100 - r.energy) * 0.55 + (r.task?.live ? 12 : 0) + r.waitMins * 0.8, 0, 100);
  r.stress = stress;
  const prev = r.mood;
  r.mood = stress > 68 ? "stressed" : stress > 45 ? "tired" : r.doneToday >= 3 && r.energy > 65 ? "proud" : r.energy > 60 ? "happy" : "ok";
  if (prev !== r.mood && r.mood === "stressed" && r.visible) {
    rlog(r, "Feeling stretched — too much on at once");
    event(`😰 ${r.name} is stressed — ${ROOMS[r.room].name} is overloaded`, { dept: r.room, robot: r });
  }
}

// A manager whose team stays overloaded walks to your desk and asks for an
// intern. You approve or decline from the dashboard.
function maybeRequestIntern(mgr) {
  const dept = mgr.room;
  const load = teamLoad(dept);
  const overloaded = load.pct >= 135 && sim.counts[dept] < MAX_WORKERS;
  mgr.loadMins = overloaded ? (mgr.loadMins || 0) + 1 : 0;
  if (mgr.loadMins < 25) return;
  if (sim.requests.some((q) => q.dept === dept && q.status === "open")) return;
  mgr.loadMins = 0;
  const req = {
    id: `req-${dept}-${Math.floor(sim.t)}`, dept, status: "open", at: sim.t,
    manager: mgr.name,
    reason: `${load.queue} task(s) queued, ${load.busy}/${load.workers} robots busy, ${load.incidents} incident(s) open`,
  };
  sim.requests.unshift(req);
  const task = newTask(dept, { title: `Ask ${sim.ceoName} for an intern`, steps: [S("ceo", `Asking {ceo} to approve an intern for ${ROOMS[dept].name} — ${req.reason}`, 4)] }, { live: true, kind: "hiring", requestId: req.id });
  if (mgr.task) { sim.queues[dept].unshift(mgr.task); mgr.task = null; }
  assign(mgr, task, null);
  event(`🙋 ${mgr.name} is asking for an intern for ${ROOMS[dept].name}`, { dept, live: true, robot: mgr });
}

export function approveIntern(id) {
  const req = sim.requests.find((q) => q.id === id);
  if (!req || req.status !== "open") return;
  req.status = "approved";
  const idx = sim.counts[req.dept];
  sim.interns.add(`${req.dept}-w${idx}`);
  setCount(req.dept, idx + 1);
  const mgr = sim.robots.get(`${req.dept}-m`);
  if (mgr) rlog(mgr, `${sim.ceoName} approved an intern — onboarding them now`);
  event(`🎓 Intern approved for ${ROOMS[req.dept].name} — starting today`, { dept: req.dept, live: true });
  if (sim.deskVisitor?.kind === "hiring") sim.deskVisitor = null;
  emit();
}
export function declineIntern(id) {
  const req = sim.requests.find((q) => q.id === id);
  if (!req || req.status !== "open") return;
  req.status = "declined";
  const mgr = sim.robots.get(`${req.dept}-m`);
  if (mgr) { rlog(mgr, `${sim.ceoName} declined the intern request — re-prioritising instead`); mgr.mood = "tired"; }
  event(`🚫 Intern request for ${ROOMS[req.dept].name} declined`, { dept: req.dept });
  if (sim.deskVisitor?.kind === "hiring") sim.deskVisitor = null;
  emit();
}

// ---------- all-hands announcements ----------
export function announce(text) {
  sim.announcement = { text, start: Math.floor(sim.t) + 1, end: Math.floor(sim.t) + 45 };
  event(`📣 ${sim.ceoName} called an all-hands: "${text}"`, { live: true });
  emit();
}
function announcementActive() {
  const a = sim.announcement;
  return a && sim.t >= a.start && sim.t < a.end ? a : null;
}

// ---------- corridor small talk ----------
function corridorChats() {
  const inCorridor = [...sim.robots.values()].filter((r) => r.visible && !roomAt(r.pos) && r.mode === "work" && !r.chatUntil);
  for (let i = 0; i < inCorridor.length; i++) {
    for (let j = i + 1; j < inCorridor.length; j++) {
      const a = inCorridor[i], b = inCorridor[j];
      if (a.chatUntil || b.chatUntil) continue;
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > 46) continue;
      if (Math.random() > 0.35) continue;
      const topic = pick(["the new pitch deck", "last night's match", "the scraper bug", "lunch options", "the CEO's latest approval", "the Kohli room booking"]);
      [a, b].forEach((x, k) => {
        x.chatUntil = sim.t + 3;
        x.chatWith = (k === 0 ? b : a).name;
        rlog(x, `Stopped in the corridor to chat with ${x.chatWith} about ${topic}`);
      });
    }
  }
}

export function everyoneHome() {
  for (const r of sim.robots.values()) if (r.visible) return false;
  return true;
}
export function isNight() {
  const tod = todOf();
  return tod >= 19 * 60 || tod < 7 * 60 + 30;
}

export function skipToMorning() {
  const day = dayOf();
  const target = (todOf() >= 450 ? day + 1 : day) * 1440 + 450;
  while (sim.t < target) {
    sim.t = Math.min(target, Math.floor(sim.t) + 1);
    minuteTick();
  }
  for (const r of sim.robots.values()) if (r.path.length) { r.pos = { ...r.path[r.path.length - 1] }; r.path = []; }
  emit();
}

let running = false;
let last = 0;
function frame(now) {
  const dtReal = Math.min(0.5, (now - last) / 1000); // tolerate throttled/background frames
  last = now;
  if (!sim.paused) {
    const boost = sim.autoNight && isNight() && everyoneHome() ? 40 : 1;
    const dtSim = dtReal * sim.speed * boost;
    const before = Math.floor(sim.t);
    sim.t += dtSim;
    const after = Math.floor(sim.t);
    for (let m = before + 1, n = 0; m <= after && n < 240; m++, n++) {
      const keep = sim.t;
      sim.t = m;
      minuteTick();
      sim.t = keep;
    }
    const dist = dtSim * WALK_PX_PER_MIN;
    for (const r of [...sim.robots.values()]) {
      if (!r.visible) continue;
      if (r.chatUntil && r.chatUntil >= sim.t) continue; // stopped for a corridor chat
      move(r, Math.min(dist, 400));
    }
  }
  emit();
  requestAnimationFrame(frame);
}

export function startSim({ ceoName, saved } = {}) {
  if (ceoName) sim.ceoName = ceoName;
  if (running) return;
  running = true;
  const restored = saved ? importState(saved) : false;
  if (!restored) syncRoster(true);
  for (const r of sim.robots.values()) enterMode(r, desiredMode(r), true);
  for (const dept of TEAM_KEYS) {
    sim.queues[dept].push(newTask(dept, pick(CATALOG[dept])), newTask(dept, pick(CATALOG[dept])));
  }
  event(restored ? `🏢 Picked the day back up at ${fmtTime(sim.t)} — ${fmtDate()}` : `🏢 Office opened — ${fmtDate()}`);
  last = performance.now();
  requestAnimationFrame(frame);
}

export function setSpeed(v) { sim.speed = v; emit(); }
export function togglePause() { sim.paused = !sim.paused; emit(); }

// ---------- real backend activity ----------
const deptFor = (d) => DEPT_KEY[d] || "ops";

export function ingestActivity(items, { initial = false } = {}) {
  const fresh = items.filter((i) => !sim.seenActivity.has(i._id)).reverse(); // oldest first
  fresh.forEach((i) => sim.seenActivity.add(i._id));
  if (initial) {
    fresh.slice(-8).forEach((i) => event(`🗂 ${i.actorName}: ${i.action}${i.detail ? ` — ${i.detail}` : ""} (earlier, server log)`, { dept: deptFor(i.department) }));
    return;
  }
  for (const item of fresh) handleActivity(item);
}

function handleActivity(item) {
  const a = item.action || "";
  const detail = item.detail || "";
  const company = detail.replace(/\s*<.*>$/, "");
  const ceo = sim.ceoName;

  if (/outreach approved/i.test(a)) {
    const task = newTask("ops", {
      title: `Deliver approved email — ${company}`,
      steps: [
        S("ceo", `Collecting the approved draft for ${company} from {ceo}'s desk 📄`, 3),
        S("self", `Sending the email to ${company} from the desk ✉️`, 4),
      ],
    }, { live: true, entityId: item.entityId });
    task.doneText = (r) => `✉️ ${r.name} sent the approved email to ${company}${task.confirmed ? " — delivered via SMTP" : ""}`;
    event(`📝 ${ceo} approved the draft for ${company}`, { dept: "exec", live: false });
    const r = addLiveTask("ops", task, "Quill");
    if (r) toast(`✉️ ${r.name} is on the way to your desk to collect the ${company} draft`);
    return;
  }
  if (/email sent/i.test(a)) {
    const all = [...Object.values(sim.queues).flat(), ...[...sim.robots.values()].map((r) => r.task).filter(Boolean)];
    const t = all.find((x) => x.entityId && x.entityId === item.entityId);
    if (t) {
      t.confirmed = true;
      event(`📬 SMTP accepted the email to ${detail}`, { dept: "ops" });
      return;
    }
    addLiveTask("ops", newTask("ops", { title: `Send email — ${company}`, steps: [S("self", `Sending the email to ${company} ✉️`, 4)] }, { live: true, confirmed: true }), "Quill");
    return;
  }
  if (/send failed/i.test(a)) {
    addLiveTask("ops", newTask("ops", { title: `Report failed send — ${company}`, steps: [S("ceo", `Reporting to {ceo}: email to ${detail} failed`, 3)] }, { live: true }), "Quill");
    return;
  }
  if (/draft generated/i.test(a)) {
    addLiveTask("ops", newTask("ops", {
      title: `Draft outreach — ${company}`,
      steps: [S("self", `Drafting the ${/linkedin/i.test(a) ? "LinkedIn" : "email"} for ${company}`, 8), S("ceo", `Leaving the ${company} draft on {ceo}'s desk for approval 📥`, 3)],
    }, { live: true }), "Quill");
    return;
  }
  if (/repl(y|ied)|responded/i.test(a)) {
    addLiveTask("ops", newTask("ops", {
      title: `Reply received — ${company}`,
      steps: [S("self", `Logging the reply from ${company}`, 5), S("ceo", `Telling {ceo} that ${company} replied 🎉`, 3)],
    }, { live: true }), "Rank");
    return;
  }
  const dept = deptFor(item.department);
  const label = `${a}${detail ? ` — ${detail}` : ""}`;
  addLiveTask(dept, newTask(dept, { title: label, steps: [S("self", label, 10)] }, { live: true }));
}

// ---------- hand a task to a robot by dragging it onto them ----------
export function queuedTasks() {
  return Object.entries(sim.queues).flatMap(([dept, list]) => list.map((t) => ({ ...t, dept })));
}

export function assignTaskTo(taskId, robotId) {
  const r = sim.robots.get(robotId);
  if (!r || r.role === "staff" || !r.visible) return { ok: false, why: "That robot can't take a task right now." };
  let task = null;
  for (const dept of Object.keys(sim.queues)) {
    const i = sim.queues[dept].findIndex((t) => String(t.id) === String(taskId));
    if (i >= 0) { task = sim.queues[dept].splice(i, 1)[0]; break; }
  }
  if (!task) return { ok: false, why: "That task is no longer in a queue." };
  if (r.task) { sim.queues[r.task.dept] = sim.queues[r.task.dept] || []; sim.queues[r.task.dept].unshift(r.task); r.task.assignedTo = null; }
  task.dept = r.room;
  assign(r, task, null);
  rlog(r, `${sim.ceoName} handed this to me directly`);
  event(`🫱 ${sim.ceoName} assigned "${task.title}" to ${r.name}`, { dept: r.room, live: true, robot: r });
  emit();
  return { ok: true, robot: r.name };
}

// ---------- saving & restoring the office day ----------
export function exportState() {
  return {
    v: 2,
    savedAt: new Date().toISOString(),
    startDate: sim.startDate.toISOString(),
    t: sim.t,
    counts: sim.counts,
    interns: [...sim.interns],
    deptDone: sim.deptDone,
    requests: sim.requests.slice(0, 20),
    robots: Object.fromEntries([...sim.robots.values()].map((r) => [r.id, {
      doneToday: r.doneToday, doneTotal: r.doneTotal, coffees: r.coffees, energy: Math.round(r.energy),
      mood: r.mood, stress: Math.round(r.stress), attendance: r.attendance, log: r.log.slice(0, 40),
    }])),
    feed: sim.feed.slice(0, 120),
  };
}

export function importState(saved) {
  if (!saved || saved.v !== 2) return false;
  const savedDay = new Date(saved.startDate);
  savedDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (savedDay.getTime() !== today.getTime()) return false; // a new real day starts fresh
  sim.t = saved.t ?? sim.t;
  sim.counts = { ...sim.counts, ...(saved.counts || {}) };
  sim.interns = new Set(saved.interns || []);
  sim.deptDone = saved.deptDone || {};
  sim.requests = saved.requests || [];
  sim.feed = saved.feed || [];
  sim.restored = true;
  syncRoster(true);
  for (const [id, v] of Object.entries(saved.robots || {})) {
    const r = sim.robots.get(id);
    if (!r) continue;
    Object.assign(r, {
      doneToday: v.doneToday || 0, doneTotal: v.doneTotal || 0, coffees: v.coffees || 0,
      energy: v.energy ?? 100, mood: v.mood || "ok", stress: v.stress ?? 20,
      attendance: v.attendance || {}, log: v.log || [],
    });
  }
  return true;
}

// ---------- live backend pulse -> incidents the teams work ----------
// Every failing check from /api/company/pulse becomes a real task for the
// team that owns it. Tech investigates in the server room; everyone else
// works it at their desk. Critical ones get walked to the CEO's desk.
const OWNER_PREFERENCE = { tech: "Byte", product: "Quill", ops: "Scout", hr: "Sage", fin: "Ledger", sup: "Relay" };

function incidentSteps(team, inc) {
  const label = inc.title;
  const steps = [];
  if (team === "tech") {
    steps.push(S("server", `Checking the racks: ${label}`, 8), S("self", `Applying a fix for ${label}`, 7));
  } else if (team === "ops") {
    steps.push(S("self", `Working through: ${label}`, 10), S({ dept: "tech", who: "any" }, `Checking the data with {p}`, 6));
  } else if (team === "product") {
    steps.push(S("self", `Fixing the messaging issue: ${label}`, 9));
  } else if (team === "fin") {
    steps.push(S("self", `Reviewing the numbers: ${label}`, 9));
  } else if (team === "hr") {
    steps.push(S("self", `Looking into: ${label}`, 8));
  } else {
    steps.push(S("self", `Handling: ${label}`, 9));
  }
  if (inc.severity === "critical") steps.push(S("ceo", `Reporting to {ceo}: ${label}`, 4));
  return steps;
}

export function ingestPulse(p) {
  const first = !sim.pulse;
  sim.pulse = p;
  const seen = new Set();
  for (const inc of p.incidents || []) {
    const team = TEAM_KEYS.includes(inc.team) ? inc.team : "ops";
    seen.add(inc.key);
    const existing = sim.incidents.get(inc.key);
    if (existing) { existing.info = inc; continue; }
    const rec = { ...inc, team, openedAt: sim.t, acknowledged: false };
    sim.incidents.set(inc.key, rec);
    const task = newTask(team, { title: `${inc.severity === "critical" ? "🚨" : "⚠️"} ${inc.title}`, steps: incidentSteps(team, inc) }, { live: true, incidentKey: inc.key, kind: "incident" });
    task.doneText = (r) => `🛠 ${r.name} finished working on "${inc.title}"`;
    if (!first) event(`${inc.severity === "critical" ? "🚨" : "⚠️"} ${ROOMS[team].name}: ${inc.title}`, { dept: team, live: true });
    addLiveTask(team, task, OWNER_PREFERENCE[team]);
    if (inc.severity === "critical") {
      sim.alerts.unshift({ id: inc.key, at: sim.t, team, title: inc.title, detail: inc.detail, action: inc.action, severity: inc.severity });
      if (sim.alerts.length > 20) sim.alerts.length = 20;
    }
  }
  // Checks that now pass: the team stands down.
  for (const [key, rec] of [...sim.incidents]) {
    if (seen.has(key)) continue;
    sim.incidents.delete(key);
    sim.alerts = sim.alerts.filter((a) => a.id !== key);
    event(`✅ Cleared: ${rec.title}`, { dept: rec.team, live: true });
    for (const r of sim.robots.values()) {
      if (r.task?.incidentKey === key) { rlog(r, `Incident cleared: ${rec.title}`); completeTask(r); }
    }
    for (const dept of Object.keys(sim.queues)) {
      sim.queues[dept] = sim.queues[dept].filter((t) => t.incidentKey !== key);
    }
  }
  emit();
}

export function dismissAlert(id) {
  sim.alerts = sim.alerts.filter((a) => a.id !== id);
  const inc = sim.incidents.get(id);
  if (inc) inc.acknowledged = true;
  if (sim.deskVisitor?.incidentKey === id) sim.deskVisitor = null;
  emit();
}

export function teamChecks(dept) {
  return sim.pulse?.teams?.[dept] || null;
}

// ---------- queries for UI / chat ----------
export function robotsList() {
  return [...sim.robots.values()].filter((r) => !r.removing || r.visible);
}
export function activityText(r) {
  if (!r.visible) return r.removing ? "Left the company" : "Off duty — at home";
  if (r.chatUntil && r.chatUntil >= sim.t) return `💬 Stopped in the corridor, chatting with ${r.chatWith}`;
  if (r.path.length) return `🚶 ${r.goalLabel}`;
  return r.activity;
}
export function locationText(r) {
  if (!r.visible) return "Home";
  const k = roomAt(r.pos);
  if (k) return ROOMS[k].name;
  return r.pos.x < 30 ? "Lobby" : "Corridor";
}
export function statusOf(r) {
  if (!r.visible) return "off";
  if (r.path.length) return "walking";
  if (r.mode === "lunch" || r.mode === "coffee") return "break";
  if (r.mode === "standup" || r.mode === "sync" || r.mode === "meeting" || r.mode === "allhands" || (r.meetingWith && r.meetingWith.until >= sim.t)) return "meeting";
  if (r.task || r.role === "staff") return "busy";
  return "idle";
}
export function isBirthday(r, d = dateOf()) {
  return r.birthday.m === d.getMonth() && r.birthday.d === d.getDate();
}
export function isAnniversary(r, d = dateOf()) {
  return r.joined.getMonth() === d.getMonth() && r.joined.getDate() === d.getDate() && r.joined.getFullYear() < d.getFullYear();
}
export function daysUntil(m, d) {
  const now = dateOf();
  let next = new Date(now.getFullYear(), m, d);
  if (next < now) next = new Date(now.getFullYear() + 1, m, d);
  return Math.round((next - now) / 86400000);
}
export function managers() {
  return [sim.robots.get("ember"), ...TEAM_KEYS.map((k) => sim.robots.get(`${k}-m`))].filter(Boolean);
}
