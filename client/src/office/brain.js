// How managers answer you in the office chat. Everything here is read from
// the live simulation, so answers are always about what's happening right
// now. Returns null when Ember should hand the question to the backend
// (leads, outreach, pipeline… — things the server knows about).
import {
  sim, ROOMS, TEAM_KEYS, MODE_LABEL, robotsList, activityText, locationText, fmtTime, fmtDate, dateOf,
  isBirthday, isAnniversary, daysUntil, dayOf, createTask, schedule, meetingsFor, todOf,
} from "./sim.js";

function meetingsText() {
  const tod = todOf();
  const lines = ["Meetings today:", "  11:30–12:00  Managers' sync — Gavaskar Boardroom"];
  for (const m of meetingsFor()) {
    const tag = tod >= m.start && tod < m.end ? "  ◀ now" : tod >= m.end ? "  ✓" : "";
    lines.push(`  ${fmtTime(m.start)}–${fmtTime(m.end)}  ${m.title} — ${ROOMS[m.room].name} (${m.attendees.map((id) => sim.robots.get(id)?.name).filter(Boolean).join(", ")})${tag}`);
  }
  return { text: lines.join("\n"), mono: true };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (s, n) => String(s).slice(0, n).padEnd(n);

function robotDetail(r) {
  const a = r.attendance[dayOf()] || {};
  const lines = [
    `${r.name} — ${r.title} (${ROOMS[r.room].name})`,
    `• Status: ${r.visible ? MODE_LABEL[r.mode] : "Off duty"}${r.path.length ? " · walking" : ""}`,
    `• Doing: ${activityText(r)}`,
    `• Location: ${locationText(r)}`,
  ];
  if (r.task) {
    const s = r.task.steps[r.task.i];
    lines.push(`• Task: "${r.task.title}"${r.task.live ? " ⚡live" : ""} — step ${r.task.i + 1}/${r.task.steps.length}${s ? ` (${s.done}/${s.dur} min)` : ""}`);
  }
  lines.push(`• Today: ${r.doneToday} tasks done · ${r.coffees} coffee breaks · energy ${Math.round(r.energy)}%`);
  lines.push(`• Clocked in ${a.in != null ? fmtTime(a.in) : "—"} · out ${a.out != null ? fmtTime(a.out) : r.visible ? "still here" : "—"}`);
  return lines.join("\n");
}

function teamSummary(dept) {
  const people = robotsList().filter((r) => r.room === dept);
  const q = sim.queues[dept] || [];
  const lines = [`${ROOMS[dept].name} — ${people.length} on the team, ${sim.deptDone[dept] || 0} tasks done today, ${q.length} queued`];
  for (const r of people) lines.push(`• ${r.name}${r.role === "manager" ? " (mgr)" : ""}: ${activityText(r)}`);
  if (q.length) lines.push(`Queue: ${q.map((t) => `"${t.title}"`).join(", ")}`);
  return lines.join("\n");
}

function companySummary() {
  const all = robotsList();
  const here = all.filter((r) => r.visible);
  const brk = here.filter((r) => r.mode === "lunch" || r.mode === "coffee").length;
  const busy = here.filter((r) => r.task).length;
  const lines = [
    `${fmtDate()} · ${fmtTime(sim.t)} — ${here.length}/${all.length} in the office, ${busy} on tasks, ${brk} on a break.`,
  ];
  for (const k of TEAM_KEYS) {
    const team = all.filter((r) => r.room === k);
    const t = team.filter((r) => r.task).length;
    lines.push(`• ${ROOMS[k].name}: ${team.filter((r) => r.visible).length}/${team.length} in, ${t} busy, ${sim.deptDone[k] || 0} done, ${sim.queues[k].length} queued`);
  }
  const live = all.filter((r) => r.task?.live);
  if (live.length) lines.push(`Live work: ${live.map((r) => `${r.name} → "${r.task.title}"`).join("; ")}`);
  if (sim.pendingApprovals) lines.push(`📥 ${sim.pendingApprovals} draft(s) are waiting on your desk for approval.`);
  return lines.join("\n");
}

function birthdays() {
  const list = robotsList()
    .map((r) => ({ r, days: daysUntil(r.birthday.m, r.birthday.d) }))
    .sort((a, b) => a.days - b.days);
  const today = list.filter((x) => x.days === 0);
  const soon = list.filter((x) => x.days > 0 && x.days <= 30);
  const lines = [];
  if (today.length) lines.push(`🎂 Today: ${today.map((x) => x.r.name).join(", ")} — cake is booked with Basil in the cafeteria!`);
  lines.push(soon.length ? "Upcoming (next 30 days):" : "No other birthdays in the next 30 days.");
  for (const x of soon) lines.push(`• ${pad(x.r.name, 10)} ${pad(ROOMS[x.r.room].name, 11)} ${MONTHS[x.r.birthday.m]} ${x.r.birthday.d} (in ${x.days}d)`);
  lines.push("", "Full calendar:");
  for (const x of [...list].sort((a, b) => a.r.birthday.m - b.r.birthday.m || a.r.birthday.d - b.r.birthday.d)) {
    lines.push(`  ${pad(`${MONTHS[x.r.birthday.m]} ${x.r.birthday.d}`, 7)} ${x.r.name}`);
  }
  return { text: lines.join("\n"), mono: true };
}

function anniversaries() {
  const now = dateOf();
  const list = robotsList()
    .map((r) => ({ r, years: now.getFullYear() - r.joined.getFullYear(), days: daysUntil(r.joined.getMonth(), r.joined.getDate()) }))
    .sort((a, b) => a.days - b.days);
  const lines = [];
  const today = list.filter((x) => isAnniversary(x.r));
  if (today.length) lines.push(`🏅 Today: ${today.map((x) => `${x.r.name} (${x.years} yr${x.years > 1 ? "s" : ""})`).join(", ")}`);
  lines.push("Work anniversaries:");
  lines.push(`  ${pad("Name", 10)} ${pad("Joined", 12)} ${pad("Tenure", 8)} Next`);
  for (const x of list) {
    const notYet = new Date(now.getFullYear(), x.r.joined.getMonth(), x.r.joined.getDate()) > now;
    const tenure = Math.max(0, x.years - (notYet ? 1 : 0));
    lines.push(`  ${pad(x.r.name, 10)} ${pad(x.r.joined.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), 12)} ${pad(`${tenure} yr`, 8)} ${x.days === 0 ? "today 🎉" : `in ${x.days}d`}`);
  }
  return { text: lines.join("\n"), mono: true };
}

function attendance(dayOffset = 0) {
  const day = dayOf() - dayOffset;
  const lines = [`Attendance — ${dayOffset ? "yesterday" : "today"} (${fmtDate(day * 1440)})`, `  ${pad("Name", 10)} ${pad("Dept", 11)} ${pad("In", 6)} ${pad("Out", 11)}`];
  for (const r of robotsList()) {
    const a = r.attendance[day] || {};
    const out = a.out != null ? fmtTime(a.out) : a.in != null ? (dayOffset ? "—" : "in office") : "—";
    const inn = a.in != null ? fmtTime(a.in) : dayOffset ? "absent" : `due ${fmtTime(schedule(r, day).arrive)}`;
    lines.push(`  ${pad(r.name, 10)} ${pad(ROOMS[r.room].name, 11)} ${pad(inn, 6)} ${pad(out, 11)}`);
  }
  const present = robotsList().filter((r) => r.attendance[day]?.in != null).length;
  lines.push("", `${present}/${robotsList().length} clocked in.`);
  return { text: lines.join("\n"), mono: true };
}

function fullStatus() {
  const lines = [`Status update — ${fmtTime(sim.t)}`, `  ${pad("Name", 10)} ${pad("Dept", 11)} ${pad("State", 15)} Doing`];
  for (const r of robotsList()) {
    lines.push(`  ${pad(r.name, 10)} ${pad(ROOMS[r.room].name, 11)} ${pad(r.visible ? MODE_LABEL[r.mode] : "Off duty", 15)} ${activityText(r)}`);
  }
  return { text: lines.join("\n"), mono: true };
}

function findRobot(text) {
  const t = text.toLowerCase();
  return robotsList().find((r) => new RegExp(`\\b${r.name.toLowerCase()}\\b`).test(t));
}

function findDept(text) {
  const t = text.toLowerCase();
  const map = { ops: /\b(ops|operations)\b/, tech: /\b(tech|engineering|dev)\b/, hr: /\b(hr|people)\b/, fin: /\b(finance|fin|accounts)\b/, sup: /\b(support|customer)\b/ };
  return Object.keys(map).find((k) => map[k].test(t));
}

export function answer(manager, text) {
  const t = text.toLowerCase();
  const mine = manager.room;

  // Delegation: "assign X to tech", "please ask ops to X", "can you X"
  const assign = text.match(/^(?:please\s+)?(?:assign|delegate|task|ask\s+\w+\s+to|can you|could you|get (?:the )?team to)\s+(.+)$/i);
  if (assign) {
    let dept = mine === "exec" ? findDept(text) || "ops" : mine;
    let title = assign[1].replace(/\s+to\s+(the\s+)?(ops|operations|tech|hr|finance|support)( team)?\s*$/i, "").replace(/[.?!]+$/, "");
    title = title.charAt(0).toUpperCase() + title.slice(1);
    createTask(dept, title, { live: true });
    return { text: `On it — "${title}" is queued for ${ROOMS[dept].name}. ${sim.robots.get(`${dept}-m`)?.name || "The manager"} will hand it to the next free robot; you'll see them start on the floor.` };
  }

  if (/meeting|room|book(ed|ing)|tendulkar|dhoni|kohli|kapil|gavaskar/.test(t)) return meetingsText();

  const who = findRobot(text);
  if (who && who.id !== manager.id) return { text: robotDetail(who) };

  if (mine === "hr") {
    if (/birthday|bday|b'day/.test(t)) return birthdays();
    if (/anniversar|tenure|joined|joining/.test(t)) return anniversaries();
    if (/yesterday/.test(t)) return attendance(1);
    if (/log ?in|log ?off|log ?out|clock|attendance|in.?time|out.?time|punch|present|absent|timing/.test(t)) return attendance(0);
    if (/status|update|everyone|all|report|roster/.test(t)) return fullStatus();
    if (/headcount|how many/.test(t)) return { text: companySummary() };
    return { text: `Hi ${sim.ceoName}! I'm ${manager.name} from HR. I can give you:\n• "status update" — what every robot is doing\n• "attendance" — today's log-in / log-off times (or "yesterday")\n• "birthdays" and "work anniversaries"\n• details on anyone — just mention their name\nYou can also ask me to "assign <task>".` };
  }

  if (manager.role === "head") {
    const dept = findDept(text);
    if (dept && /team|department|doing|status|how/.test(t)) return { text: teamSummary(dept) };
    if (/status|overview|update|how are things|company|everyone|office/.test(t) && !/lead|outreach|pipeline|ticket/.test(t)) return { text: companySummary() };
    if (/birthday|anniversar|attendance|log ?in|log ?off/.test(t)) return { text: "That's HR's department — ask Priya in the HR chat, she keeps the attendance book and the birthday calendar." };
    return null; // → backend Ember (leads, outreach, pipeline, tickets…)
  }

  if (/status|update|team|doing|progress|how/.test(t)) return { text: teamSummary(mine) };
  if (/queue|backlog|pending/.test(t)) {
    const q = sim.queues[mine];
    return { text: q.length ? `Queued in ${ROOMS[mine].name}:\n${q.map((x, i) => `${i + 1}. ${x.title}${x.live ? " ⚡" : ""}`).join("\n")}` : "Nothing queued — the team is on top of it." };
  }
  return { text: `I'm ${manager.name}, managing ${ROOMS[mine].name}. Ask me for a "status update", our "queue", about any robot by name, or tell me to "assign <task>".` };
}

export function suggestions(manager) {
  if (manager.room === "hr") return ["Status update", "Attendance today", "Birthdays", "Work anniversaries", "Attendance yesterday"];
  if (manager.role === "head") return ["Company status", "Meetings today", "How is the tech team doing?", "Show outreach drafts", "Assign review pricing page to ops"];
  return ["Status update", "What's in the queue?", "Assign a quick audit"];
}
