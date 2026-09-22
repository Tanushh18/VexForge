import { useEffect, useRef, useState } from "react";
import {
  sim, subscribe, ROOMS, TEAM_KEYS, MODE_LABEL, MIN_WORKERS, MAX_WORKERS, robotsList, activityText, locationText,
  statusOf, fmtTime, fmtDate, dayOf, schedule, setCount, isBirthday, isAnniversary, daysUntil, dateOf, managers,
  meetingsFor, todOf, roomAt, teamChecks, teamLoad, MOODS, approveIntern, declineIntern, dismissAlert, queuedTasks,
} from "./sim.js";
import { answer, suggestions } from "./brain.js";
import { useVoice } from "../hooks/useVoice.js";
import { api } from "../services/api.js";

// Re-render at `hz` while the sim runs — panels don't need 60fps.
export function useSimTick(hz = 4) {
  const [, force] = useState(0);
  useEffect(() => {
    let last = 0;
    return subscribe(() => {
      const now = performance.now();
      if (now - last >= 1000 / hz) { last = now; force((n) => (n + 1) % 1e9); }
    });
  }, [hz]);
}

const STATUS_TEXT = { busy: "Working", idle: "At desk", walking: "Walking", break: "On break", meeting: "In a meeting", off: "Off duty" };
export function StatusChip({ r }) {
  const s = statusOf(r);
  return <span className={`st st-${s}`}>{STATUS_TEXT[s]}</span>;
}

export function Avatar({ r, size = 30 }) {
  return (
    <span className="bot-av" style={{ width: size, height: size, background: r.color }}>
      <span className="bot-visor" />
    </span>
  );
}

function Bar({ value, color = "var(--m2)" }) {
  return (
    <div className="bar"><div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>
  );
}

// ---------- inspector ----------
export function Inspector({ id, onSelect }) {
  useSimTick(5);
  const r = id && sim.robots.get(id);
  if (!r) {
    return (
      <div className="insp-empty">
        <div style={{ fontSize: 30 }}>🤖</div>
        <div>Click any robot on the floor — or a row in the roster — to see exactly what it is doing, where it is going, its task steps, schedule and full activity log.</div>
      </div>
    );
  }
  const a = r.attendance[dayOf()] || {};
  const s = schedule(r);
  const backend = sim.backend[r.name];
  return (
    <div className="insp">
      <div className="insp-head">
        <Avatar r={r} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="insp-name">{r.name} {isBirthday(r) && "🎂"} {isAnniversary(r) && "🏅"}</div>
          <div className="hint">{r.title} · {ROOMS[r.room].name}</div>
        </div>
        <StatusChip r={r} />
      </div>

      <div className="insp-now">
        <div className="lbl">Right now</div>
        <div className="now-text">{activityText(r)}</div>
        <div className="hint" style={{ marginTop: 4 }}>📍 {locationText(r)}{r.path.length ? ` → ${r.goalLabel.split(" — ")[0].replace("Heading to ", "")}` : ""}</div>
      </div>

      {r.task && (
        <div className="insp-card">
          <div className="lbl">Current task {r.task.live && <span className="live">LIVE</span>}</div>
          <div style={{ fontWeight: 600, fontSize: 13.5, margin: "4px 0 8px" }}>{r.task.title}</div>
          {r.task.steps.map((st, i) => {
            const partner = st.partnerId && sim.robots.get(st.partnerId);
            const label = st.label.replace("{p}", partner?.name || "a colleague").replace("{ceo}", sim.ceoName);
            const state = i < r.task.i ? "done" : i === r.task.i ? "now" : "todo";
            return (
              <div className={`step step-${state}`} key={i}>
                <span className="step-ic">{state === "done" ? "✓" : state === "now" ? "▶" : "○"}</span>
                <div style={{ flex: 1 }}>
                  <div>{label}</div>
                  {state === "now" && <Bar value={(st.done / st.dur) * 100} />}
                </div>
                <span className="hint">{st.dur}m</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="insp-grid">
        <div><div className="lbl">Energy</div><Bar value={r.energy} color={r.energy > 50 ? "var(--ok)" : r.energy > 25 ? "var(--warn)" : "var(--err)"} /><div className="hint">{Math.round(r.energy)}%</div></div>
        <div><div className="lbl">Tasks today / total</div><div className="big">{r.doneToday} / {r.doneTotal}</div></div>
        <div><div className="lbl">Clocked in</div><div className="big">{a.in != null ? fmtTime(a.in) : "—"}</div></div>
        <div><div className="lbl">Clocked out</div><div className="big">{a.out != null ? fmtTime(a.out) : r.visible ? "on shift" : "—"}</div></div>
        <div><div className="lbl">Coffee breaks</div><div className="big">{r.coffees}</div></div>
        <div><div className="lbl">Mode</div><div className="big">{r.visible ? MODE_LABEL[r.mode] : "Off duty"}</div></div>
      </div>

      <div className="insp-card">
        <div className="lbl">Today's schedule</div>
        <div className="sched">
          <span>🟢 Arrive {fmtTime(s.arrive)}</span>
          {r.role !== "staff" && r.role !== "head" && <span>🧍 Stand-up 09:30</span>}
          {s.coffee.map((c, i) => <span key={i}>☕ {fmtTime(c[0])}</span>)}
          {(r.role === "manager" || r.role === "head") && <span>💬 Sync 11:30</span>}
          {meetingsFor().filter((m) => m.attendees.includes(r.id)).map((m) => <span key={m.id}>📅 {fmtTime(m.start)} {ROOMS[m.room].name}</span>)}
          <span>🍽 Lunch {fmtTime(s.lunch[0])}–{fmtTime(s.lunch[1])}</span>
          <span>🔴 Leave {fmtTime(s.leave)}</span>
        </div>
      </div>

      <div className="insp-card">
        <div className="lbl">Profile</div>
        <div className="hint" style={{ lineHeight: 1.7 }}>
          🎂 Birthday: {new Date(2000, r.birthday.m, r.birthday.d).toLocaleDateString(undefined, { day: "numeric", month: "long" })} ({isBirthday(r) ? "today!" : `${daysUntil(r.birthday.m, r.birthday.d)} days away`})<br />
          🏅 Joined: {r.joined.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}<br />
          {backend && <>🗄 Backend agent: <b>{backend.status}</b> — {backend.currentTask} · {backend.tasksCompleted} real tasks done<br /></>}
          {backend?.skills?.length > 0 && <>🧠 Skills: {backend.skills.join(", ")}</>}
        </div>
      </div>

      <div className="insp-card">
        <div className="lbl">Activity log</div>
        <div className="rlog">
          {r.log.map((l, i) => (
            <div key={i}><span className="t">{fmtTime(l.t)}</span>{l.text}</div>
          ))}
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>Close</button>
    </div>
  );
}

// ---------- live feed ----------
export function Feed({ onSelect }) {
  useSimTick(3);
  const [filter, setFilter] = useState("all");
  const items = sim.feed.filter((f) => filter === "all" || (filter === "live" ? f.live : f.dept === filter)).slice(0, 150);
  return (
    <div className="feed">
      <div className="chips">
        {["all", "live", ...TEAM_KEYS, "exec"].map((k) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : k === "live" ? "⚡ Live" : ROOMS[k].name}
          </button>
        ))}
      </div>
      <div className="feed-list">
        {items.length === 0 && <div className="hint" style={{ padding: 12 }}>Nothing yet.</div>}
        {items.map((f) => (
          <div key={f.id} className={`feed-item ${f.live ? "is-live" : ""}`} onClick={() => f.robotId && onSelect(f.robotId)}>
            <span className="dot" style={{ background: f.dept ? ROOMS[f.dept]?.color : "var(--fog-2)" }} />
            <span className="t">{fmtTime(f.t)}</span>
            <span className="x">{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- chat with managers ----------
export function ManagerChat({ initial }) {
  useSimTick(1);
  const list = managers();
  const [who, setWho] = useState(initial || "ember");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const bodyRef = useRef(null);
  const mgr = sim.robots.get(who) || list[0];
  const { listening, supported, start, speak } = useVoice({ onResult: (text) => send(text) });
  const thread = (sim.chats[who] ||= []);

  useEffect(() => { if (initial) setWho(initial); }, [initial]);
  useEffect(() => { bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight); }, [thread.length, who, busy]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || busy || !mgr) return;
    setInput("");
    thread.push({ role: "user", text: msg, t: sim.t });
    mgr.chatUntil = sim.t + 3;
    const local = answer(mgr, msg);
    if (local) {
      thread.push({ role: "mgr", ...local, t: sim.t });
      if (voiceOn) speak(local.text.replace(/[│─┌┐└┘]/g, " ").slice(0, 400));
      setWho((w) => w); // re-render
      return;
    }
    setBusy(true);
    try {
      const { reply } = await api.sendChat(msg, thread.slice(-10).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })));
      thread.push({ role: "mgr", text: reply, t: sim.t });
      if (voiceOn) speak(reply);
    } catch (err) {
      thread.push({ role: "mgr", text: `I couldn't reach the server: ${err.message}`, t: sim.t });
    } finally {
      setBusy(false);
    }
  }

  if (!mgr) return null;
  const present = mgr.visible;
  return (
    <div className="mchat">
      <div className="mchat-who">
        {list.map((m) => (
          <button key={m.id} className={`who ${m.id === who ? "on" : ""}`} onClick={() => setWho(m.id)} title={`${m.name} — ${m.title}`}>
            <Avatar r={m} size={24} />
            <span>{m.name}</span>
            <i className={`pres ${m.visible ? (statusOf(m) === "break" ? "brk" : "on") : ""}`} />
          </button>
        ))}
      </div>
      <div className="mchat-sub">
        <b>{mgr.name}</b> · {mgr.title} — {present ? activityText(mgr) : "off duty (replies from phone 📱)"}
      </div>
      <div className="mchat-body" ref={bodyRef}>
        {thread.length === 0 && (
          <div className="bubble mgr">Hi {sim.ceoName} 👋 I'm {mgr.name}. {mgr.room === "hr" ? "Ask me for status updates, attendance (log-in / log-off times), birthdays or work anniversaries." : mgr.role === "head" ? "Ask me for a company status, about any robot or team — or about leads, outreach and the pipeline." : `Ask me what ${ROOMS[mgr.room].name} is working on, or assign us something.`}</div>
        )}
        {thread.map((m, i) => (
          <div key={i} className={`bubble ${m.role} ${m.mono ? "mono" : ""}`}>
            {m.text}
            <span className="bt">{fmtTime(m.t)}</span>
          </div>
        ))}
        {busy && <div className="bubble mgr">…typing</div>}
      </div>
      <div className="mchat-sugg">
        {suggestions(mgr).map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
      </div>
      <div className="mchat-input">
        <button className={`mic-btn ${voiceOn ? "on" : ""}`} title="Read replies out loud" onClick={() => setVoiceOn((v) => !v)}>{voiceOn ? "🔊" : "🔇"}</button>
        {supported && <button className={`mic-btn ${listening ? "listening" : ""}`} title="Speak instead of typing" onClick={start}>🎤</button>}
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={`Message ${mgr.name}…`} />
        <button className="btn btn-molten btn-sm" onClick={() => send()} disabled={busy}>Send</button>
      </div>
    </div>
  );
}

// ---------- roster table ----------
export function Roster({ selectedId, onSelect }) {
  useSimTick(2);
  const [dept, setDept] = useState("all");
  const rows = robotsList().filter((r) => dept === "all" || r.room === dept);
  const day = dayOf();
  return (
    <div className="card roster">
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <strong>Everyone, right now</strong>
        <div className="chips">
          {["all", "exec", ...TEAM_KEYS, "cafe"].map((k) => (
            <button key={k} className={`chip ${dept === k ? "on" : ""}`} onClick={() => setDept(k)}>{k === "all" ? "All" : ROOMS[k].name}</button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table roster-table">
          <thead>
            <tr><th>Robot</th><th>Dept</th><th>Status</th><th>Doing right now</th><th>Task progress</th><th>Location</th><th>Energy</th><th>In</th><th>Out</th><th>Done</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = r.attendance[day] || {};
              const st = r.task?.steps[r.task.i];
              return (
                <tr key={r.id} className={r.id === selectedId ? "sel" : ""} onClick={() => onSelect(r.id)}>
                  <td><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Avatar r={r} size={22} /><div><b>{r.name}</b> {isBirthday(r) && "🎂"}<div className="hint">{r.title}</div></div></div></td>
                  <td>{ROOMS[r.room].name}</td>
                  <td><StatusChip r={r} /></td>
                  <td className="doing">{activityText(r)}</td>
                  <td style={{ minWidth: 130 }}>
                    {r.task ? (<><div className="hint">{r.task.live && <span className="live">LIVE</span>} {r.task.title}</div><Bar value={((r.task.i + (st ? st.done / st.dur : 0)) / r.task.steps.length) * 100} /></>) : <span className="hint">—</span>}
                  </td>
                  <td className="hint">{locationText(r)}</td>
                  <td style={{ minWidth: 70 }}><Bar value={r.energy} color={r.energy > 50 ? "var(--ok)" : "var(--warn)"} /></td>
                  <td className="mono">{a.in != null ? fmtTime(a.in) : "—"}</td>
                  <td className="mono">{a.out != null ? fmtTime(a.out) : r.visible ? "…" : "—"}</td>
                  <td className="mono">{r.doneToday}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- staffing counter ----------
export function Staffing() {
  useSimTick(2);
  return (
    <div className="grid grid-3">
      {TEAM_KEYS.map((k) => {
        const mgr = sim.robots.get(`${k}-m`);
        const n = sim.counts[k];
        return (
          <div className="card" key={k}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="dot" style={{ background: ROOMS[k].color }} />
              <strong>{ROOMS[k].name}</strong>
            </div>
            <div className="hint">Manager: {mgr?.name} · {n} robot{n > 1 ? "s" : ""}</div>
            <div className="counter">
              <button onClick={() => setCount(k, n - 1)} disabled={n <= MIN_WORKERS}>−</button>
              <span>{n}</span>
              <button onClick={() => setCount(k, n + 1)} disabled={n >= MAX_WORKERS}>+</button>
            </div>
            <div className="hint">{robotsList().filter((r) => r.room === k && r.role === "worker").map((r) => r.name).join(", ")}</div>
          </div>
        );
      })}
      <div className="card">
        <strong>Cafeteria</strong>
        <div className="hint" style={{ marginTop: 6 }}>2 staff — Olive (barista) and Basil (head chef). Fixed.</div>
        <div className="hint" style={{ marginTop: 10 }}>New robots walk in through the entrance and take the next free desk. Removed robots finish up, pass their task back to the queue and walk out.</div>
      </div>
    </div>
  );
}

// ---------- HR ----------
export function HRView() {
  useSimTick(1);
  const day = dayOf();
  const list = robotsList();
  const now = dateOf();
  const bdays = [...list].sort((a, b) => daysUntil(a.birthday.m, a.birthday.d) - daysUntil(b.birthday.m, b.birthday.d));
  return (
    <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
      <div className="card">
        <strong>Attendance — {fmtDate()}</strong>
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>Name</th><th>Dept</th><th>Log in</th><th>Log off</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((r) => {
              const a = r.attendance[day] || {};
              const end = a.out ?? (r.visible ? sim.t : null);
              const hrs = a.in != null && end != null ? ((end - a.in) / 60).toFixed(1) : "—";
              return (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td className="hint">{ROOMS[r.room].name}</td>
                  <td className="mono">{a.in != null ? fmtTime(a.in) : `due ${fmtTime(schedule(r).arrive)}`}</td>
                  <td className="mono">{a.out != null ? fmtTime(a.out) : r.visible ? "on shift" : "—"}</td>
                  <td className="mono">{hrs}</td>
                  <td><StatusChip r={r} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card">
          <strong>🎂 Birthdays</strong>
          {bdays.slice(0, 8).map((r) => {
            const d = daysUntil(r.birthday.m, r.birthday.d);
            return (
              <div className="hr-row" key={r.id}>
                <span>{r.name}</span>
                <span className="hint">{new Date(2000, r.birthday.m, r.birthday.d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                <span className={d === 0 ? "pill pill-approved" : "hint"}>{d === 0 ? "Today!" : `in ${d}d`}</span>
              </div>
            );
          })}
        </div>
        <div className="card">
          <strong>🏅 Work anniversaries</strong>
          {[...list].sort((a, b) => daysUntil(a.joined.getMonth(), a.joined.getDate()) - daysUntil(b.joined.getMonth(), b.joined.getDate())).slice(0, 8).map((r) => {
            const d = daysUntil(r.joined.getMonth(), r.joined.getDate());
            const yrs = now.getFullYear() - r.joined.getFullYear();
            return (
              <div className="hr-row" key={r.id}>
                <span>{r.name}</span>
                <span className="hint">since {r.joined.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
                <span className={d === 0 ? "pill pill-approved" : "hint"}>{d === 0 ? `${yrs} yrs today!` : `in ${d}d`}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- modal ----------
export function Modal({ title, sub, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {sub && <div className="hint">{sub}</div>}
          </div>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Team panel shown at the top of a department popup.
export function TeamPanel({ dept, onSelect }) {
  useSimTick(2);
  const people = robotsList().filter((r) => r.room === dept);
  const q = sim.queues[dept] || [];
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="team-cards">
        {people.map((r) => (
          <div key={r.id} className="team-card" onClick={() => onSelect(r.id)}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <Avatar r={r} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}><b>{r.name}</b><div className="hint">{r.title}</div></div>
              <StatusChip r={r} />
            </div>
            <div className="doing">{activityText(r)}</div>
            {r.task && <div className="hint" style={{ marginTop: 4 }}>{r.task.live && <span className="live">LIVE</span>} {r.task.title} · step {r.task.i + 1}/{r.task.steps.length}</div>}
          </div>
        ))}
      </div>
      {TEAM_KEYS.includes(dept) && (
        <div className="hint" style={{ marginTop: 10 }}>
          {sim.deptDone[dept] || 0} tasks done today · Queue: {q.length ? q.map((t) => `${t.live ? "⚡" : ""}${t.title}`).join(" · ") : "empty"}
        </div>
      )}
    </div>
  );
}

// Things happening in the cafeteria / conference room.
export function CafeView() {
  useSimTick(2);
  const all = robotsList();
  const eating = all.filter((r) => r.mode === "lunch" && r.visible);
  const coffee = all.filter((r) => r.mode === "coffee" && r.visible);
  return (
    <div className="grid grid-2">
      <div className="card">
        <strong>🍽 Menu today</strong>
        <div className="hint" style={{ lineHeight: 1.9, marginTop: 6 }}>Veg biryani & raita · Paneer wraps · Pasta arrabbiata · Dal, rice & salad · Noodle bowls<br />☕ Espresso · Cappuccino · Masala chai · Cold brew</div>
        <div className="hint" style={{ marginTop: 8 }}>Lunch shifts 12:30 and 13:15 · Kitchen: Basil · Coffee bar: Olive</div>
      </div>
      <div className="card">
        <strong>Here now</strong>
        <div className="hint" style={{ marginTop: 6 }}>Lunch: {eating.map((r) => r.name).join(", ") || "nobody"}</div>
        <div className="hint" style={{ marginTop: 4 }}>Coffee: {coffee.map((r) => r.name).join(", ") || "nobody"}</div>
      </div>
    </div>
  );
}

export function ConfView({ roomKey }) {
  useSimTick(2);
  const tod = todOf();
  const list = meetingsFor().filter((m) => !roomKey || roomKey === "conf" || m.room === roomKey);
  const inRoom = robotsList().filter((r) => r.visible && roomAt(r.pos) === roomKey && !r.path.length);
  return (
    <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
      <div className="card">
        <strong>📅 Meetings today {roomKey && roomKey !== "conf" ? `— ${ROOMS[roomKey].name} room` : "— all rooms"}</strong>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {(!roomKey || roomKey === "conf") && (
            <div className={`mtg ${tod >= 690 && tod < 720 ? "now" : tod >= 720 ? "past" : ""}`}>
              <span className="mono">11:30–12:00</span><b>Managers' sync</b><span className="hint">Gavaskar Boardroom · Ember + all managers</span>
            </div>
          )}
          {list.map((m) => {
            const state = tod >= m.start && tod < m.end ? "now" : tod >= m.end ? "past" : "";
            return (
              <div key={m.id} className={`mtg ${state}`}>
                <span className="mono">{fmtTime(m.start)}–{fmtTime(m.end)}</span>
                <b>{m.title}{state === "now" && <span className="live">NOW</span>}</b>
                <span className="hint">{ROOMS[m.room].name} · {m.attendees.map((id) => sim.robots.get(id)?.name).filter(Boolean).join(", ")}</span>
              </div>
            );
          })}
          {list.length === 0 && <div className="hint">No bookings.</div>}
        </div>
      </div>
      <div className="card">
        <strong>In the room now</strong>
        <div className="hint" style={{ marginTop: 6 }}>{inRoom.map((r) => r.name).join(", ") || "Empty"}</div>
        <div className="hint" style={{ marginTop: 12 }}>Meeting rooms are named after cricket legends — Tendulkar, Dhoni, Kohli and Kapil Dev — with the Gavaskar Boardroom for the daily managers' sync. Teams book them for cross-department meetings; attendees leave their desks, walk over and sit at the table.</div>
      </div>
    </div>
  );
}

export function Toasts() {
  useSimTick(4);
  const now = performance.now();
  const live = sim.toasts.filter((t) => now - t.at < 7000);
  return (
    <div className="toasts">
      {live.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
  );
}

// ---------- live systems board (same shape for every team) ----------
const STATE_ORDER = { down: 0, warn: 1, ok: 2, off: 3 };
export function TeamBoard({ dept, onAction }) {
  useSimTick(1);
  const board = teamChecks(dept);
  const load = TEAM_KEYS.includes(dept) ? teamLoad(dept) : null;
  if (!board) return <div className="hint">Waiting for the first health check from the server…</div>;
  const checks = [...board.checks].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  return (
    <div className="board">
      <div className="board-metrics">
        {board.metrics.map((m) => (
          <div key={m.label} className="bm"><div className="n">{m.value}</div><div className="l">{m.label}</div></div>
        ))}
        {load && <div className="bm"><div className="n" style={{ color: load.pct > 135 ? "var(--err)" : load.pct > 90 ? "var(--warn)" : "var(--ok)" }}>{load.pct}%</div><div className="l">Team load</div></div>}
      </div>
      <div className="board-checks">
        {checks.map((c) => (
          <div key={c.key} className={`chk chk-${c.state}`} onClick={() => c.action && onAction?.(c.action)}>
            <span className="led" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="chk-l">{c.label}</div>
              <div className="hint">{c.detail}</div>
            </div>
            <span className="chk-v">{String(c.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- incidents the office is working right now ----------
export function Incidents({ onAction }) {
  useSimTick(2);
  const list = [...sim.incidents.values()].sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1));
  if (!list.length) return <div className="hint" style={{ padding: 12 }}>No open incidents — every system check is green. 🎉</div>;
  return (
    <div className="inc-list">
      {list.map((i) => {
        const owner = [...sim.robots.values()].find((r) => r.task?.incidentKey === i.key);
        return (
          <div key={i.key} className={`inc inc-${i.severity}`}>
            <div className="inc-head">
              <span className="dot" style={{ background: ROOMS[i.team].color }} />
              <b>{i.title}</b>
              <span className={`pill ${i.severity === "critical" ? "pill-lost" : "pill-new"}`}>{i.severity}</span>
            </div>
            <div className="hint">{i.detail}</div>
            <div className="hint" style={{ marginTop: 4 }}>
              {ROOMS[i.team].name} · {owner ? `${owner.name} is on it — ${activityText(owner)}` : "queued for the next free robot"}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {i.action && <button className="btn btn-ghost btn-sm" onClick={() => onAction(i.action)}>Open {i.action}</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => dismissAlert(i.key)}>Acknowledge</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- hiring requests from overloaded managers ----------
export function HiringRequests() {
  useSimTick(2);
  const open = sim.requests.filter((r) => r.status === "open");
  const past = sim.requests.filter((r) => r.status !== "open").slice(0, 5);
  return (
    <div>
      {open.length === 0 && <div className="hint">No open requests — every team is coping with its current headcount.</div>}
      {open.map((r) => (
        <div className="req" key={r.id}>
          <div><b>{r.manager}</b> ({ROOMS[r.dept].name}) is asking for an intern</div>
          <div className="hint">{r.reason}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="btn btn-molten btn-sm" onClick={() => approveIntern(r.id)}>Approve intern</button>
            <button className="btn btn-ghost btn-sm" onClick={() => declineIntern(r.id)}>Not now</button>
          </div>
        </div>
      ))}
      {past.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl">Earlier</div>
          {past.map((r) => <div key={r.id} className="hint">{ROOMS[r.dept].name} · {r.manager} — {r.status}</div>)}
        </div>
      )}
    </div>
  );
}

// ---------- the robot standing at your desk ----------
export function DeskVisitor({ onAction }) {
  useSimTick(3);
  const v = sim.deskVisitor;
  if (!v) return null;
  const r = sim.robots.get(v.robotId);
  return (
    <div className="visitor">
      <div className="visitor-head">
        {r && <Avatar r={r} size={30} />}
        <div style={{ flex: 1 }}>
          <b>{v.name}</b> <span className="hint">is at your desk</span>
          <div className="hint">{v.title} · {ROOMS[v.dept].name}</div>
        </div>
      </div>
      <div className="visitor-body">{v.label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {v.kind === "hiring" && (
          <>
            <button className="btn btn-molten btn-sm" onClick={() => approveIntern(sim.requests.find((q) => q.status === "open" && q.dept === v.dept)?.id)}>Approve intern</button>
            <button className="btn btn-ghost btn-sm" onClick={() => declineIntern(sim.requests.find((q) => q.status === "open" && q.dept === v.dept)?.id)}>Not now</button>
          </>
        )}
        {v.kind === "incident" && <button className="btn btn-ghost btn-sm" onClick={() => dismissAlert(v.incidentKey)}>Acknowledge</button>}
        {v.entityId && <button className="btn btn-molten btn-sm" onClick={() => onAction("outreach")}>Open the draft</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => onAction("outreach")}>Open approvals</button>
      </div>
    </div>
  );
}

// ---------- performance ----------
export function Performance() {
  useSimTick(1);
  const rows = robotsList().filter((r) => r.role !== "staff");
  const byTeam = TEAM_KEYS.map((k) => ({ k, load: teamLoad(k), done: sim.deptDone[k] || 0, people: rows.filter((r) => r.room === k) }));
  return (
    <div>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {byTeam.map((t) => (
          <div className="card" key={t.k}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ background: ROOMS[t.k].color }} /><strong>{ROOMS[t.k].name}</strong>
            </div>
            <div className="insp-grid" style={{ marginTop: 10 }}>
              <div><div className="lbl">Load</div><div className="big" style={{ color: t.load.pct > 135 ? "var(--err)" : "inherit" }}>{t.load.pct}%</div></div>
              <div><div className="lbl">Done today</div><div className="big">{t.done}</div></div>
              <div><div className="lbl">Queue</div><div className="big">{t.load.queue}</div></div>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>Mood: {t.people.map((p) => `${p.name} ${MOODS[p.mood]?.emoji || ""}`).join("  ")}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <strong>Per-robot performance</strong>
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>Robot</th><th>Team</th><th>Today</th><th>Total</th><th>Energy</th><th>Stress</th><th>Mood</th><th>Coffees</th></tr></thead>
          <tbody>
            {rows.sort((a, b) => b.doneToday - a.doneToday).map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b>{r.isIntern && <span className="pill pill-default" style={{ marginLeft: 6 }}>intern</span>}</td>
                <td className="hint">{ROOMS[r.room].name}</td>
                <td className="mono">{r.doneToday}</td>
                <td className="mono">{r.doneTotal}</td>
                <td style={{ minWidth: 70 }}><Bar value={r.energy} color={r.energy > 50 ? "var(--ok)" : "var(--warn)"} /></td>
                <td style={{ minWidth: 70 }}><Bar value={r.stress} color={r.stress > 68 ? "var(--err)" : r.stress > 45 ? "var(--warn)" : "var(--ok)"} /></td>
                <td>{MOODS[r.mood]?.emoji} <span className="hint">{MOODS[r.mood]?.label}</span></td>
                <td className="mono">{r.coffees}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- wall ticker ----------
export function Ticker() {
  useSimTick(1);
  const p = sim.pulse;
  if (!p) return null;
  const items = [
    `LEADS ${p.leads.total}`, `HOT ${p.leads.hot}`, `NEW/WK ${p.leads.newThisWeek}`,
    `DRAFTS ${p.outreach.drafts}`, `SENT TODAY ${p.outreach.sentToday}`, `QUOTA ${p.quota.remaining}/${p.quota.cap}`,
    `TICKETS ${p.tickets.open}`, `SITES ${p.sites.filter((s) => s.ok).length}/${p.sites.length} UP`,
    `INCIDENTS ${p.incidents.length}`, `WORKER ${p.worker.anyOnline ? "ONLINE" : "OFFLINE"}`,
  ];
  return (
    <div className="ticker"><div className="ticker-in">{[...items, ...items].map((t, i) => <span key={i}>{t}</span>)}</div></div>
  );
}


// ---------- the backlog you can drag onto a robot ----------
export function Backlog({ onDragState, picked, onPick }) {
  useSimTick(2);
  const tasks = queuedTasks();
  return (
    <div className="backlog">
      <div className="hint" style={{ marginBottom: 8 }}>
        Click a task then click a robot — or drag it onto one — to hand it over yourself. Managers assign the rest automatically.
      </div>
      {picked && <div className="pick-hint">👉 Now click any robot on the floor to give it this task.</div>}
      {tasks.length === 0 && <div className="hint">Every queue is empty — the teams are on top of things.</div>}
      {tasks.map((t) => (
        <div
          key={t.id}
          className={`bl-task ${t.live ? "live" : ""} ${String(picked) === String(t.id) ? "picked" : ""}`}
          onClick={() => onPick?.(String(picked) === String(t.id) ? null : String(t.id))}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData("text/task", String(t.id)); e.dataTransfer.effectAllowed = "move"; onDragState?.(true); }}
          onDragEnd={() => onDragState?.(false)}
        >
          <span className="dot" style={{ background: ROOMS[t.dept].color }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bl-t">{t.live && <span className="live">LIVE</span>} {t.title}</div>
            <div className="hint">{ROOMS[t.dept].name} · {t.steps.length} step(s)</div>
          </div>
          <span className="bl-grip">⠿</span>
        </div>
      ))}
    </div>
  );
}
