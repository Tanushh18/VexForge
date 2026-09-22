import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api.js";
import { useAuth } from "../AuthContext.jsx";
import OfficeFloor from "../office/OfficeFloor.jsx";
import {
  sim, startSim, applyOrgTree, ingestActivity, setSpeed, togglePause, skipToMorning, fmtTime, fmtDate, todOf,
  robotsList, statusOf, ROOMS, isNight, everyoneHome, ingestPulse, announce, TEAM_KEYS, teamLoad, exportState, assignTaskTo,
} from "../office/sim.js";
import {
  useSimTick, Inspector, Feed, ManagerChat, Roster, Staffing, HRView, Modal, TeamPanel, CafeView, ConfView, Toasts,
  TeamBoard, Incidents, HiringRequests, DeskVisitor, Performance, Ticker, Backlog,
} from "../office/panels.jsx";
import Outreach from "./Outreach.jsx";
import Pipeline from "./Pipeline.jsx";
import Leads from "./Leads.jsx";
import Support from "./Support.jsx";
import Activity from "./Activity.jsx";
import Admin from "./Admin.jsx";

const ACTIVITY_POLL_MS = 6000;
const PULSE_POLL_MS = 12000;
const SAVE_MS = 20000;
const DATA_POLL_MS = 60000;
const SPEEDS = [0.5, 1, 3, 10, 30];

const FUNNEL_STAGES = ["new", "reviewed", "outreach_drafted", "outreach_sent", "responded", "call_booked", "won"];
const STAGE_LABELS = { new: "New", reviewed: "Reviewed", outreach_drafted: "Drafted", outreach_sent: "Sent", responded: "Responded", call_booked: "Call booked", won: "Won" };

function LeadFunnel({ leads }) {
  const counts = FUNNEL_STAGES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  let lost = 0;
  for (const l of leads) {
    if (l.stage === "lost") lost += 1;
    else if (counts[l.stage] !== undefined) counts[l.stage] += 1;
  }
  const max = Math.max(1, ...FUNNEL_STAGES.map((s) => counts[s]));
  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <strong>Pipeline funnel</strong>
        {lost > 0 && <span className="pill pill-lost">{lost} lost</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {FUNNEL_STAGES.map((s) => (
          <div key={s} style={{ display: "grid", gridTemplateColumns: "92px 1fr 26px", alignItems: "center", gap: 10 }}>
            <span className="hint">{STAGE_LABELS[s]}</span>
            <div className="bar" style={{ height: 9 }}><div style={{ width: counts[s] ? `${Math.max((counts[s] / max) * 100, 4)}%` : 0, background: "var(--molten)" }} /></div>
            <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>{counts[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PAGES = {
  outreach: { title: "Outreach approvals", sub: "Approve an email draft and a robot walks to your desk, collects it and sends it.", el: () => <Outreach /> },
  pipeline: { title: "Lead pipeline", el: () => <Pipeline /> },
  leads: { title: "CRM · Leads", el: () => <Leads /> },
  support: { title: "Call & support", el: () => <Support /> },
  activity: { title: "Server activity log", el: () => <Activity /> },
  admin: { title: "Admin · models, jobs & deep scan", el: () => <Admin /> },
  hr: { title: "HR — attendance, birthdays & anniversaries", el: () => <HRView /> },
  staffing: { title: "Staffing", sub: "Add or remove robots per department.", el: () => <Staffing /> },
  incidents: { title: "Incidents", sub: "Every failing system check, and the robot working it.", el: (a) => <Incidents onAction={a} /> },
  performance: { title: "Performance & morale", sub: "Output, load and how each robot is holding up.", el: () => <Performance /> },
  systems: { title: "All systems", sub: "Live health of every team's backend.", el: (a) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {TEAM_KEYS.map((k) => (
        <div key={k}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="dot" style={{ background: ROOMS[k].color }} /><strong>{ROOMS[k].name}</strong>
          </div>
          <TeamBoard dept={k} onAction={a} />
        </div>
      ))}
    </div>
  ) },
};

const ROOM_TABS = {
  exec: ["outreach", "activity", "performance"],
  ops: ["pipeline", "leads"],
  product: ["outreach", "leads"],
  tech: ["admin", "activity"],
  hr: ["hr", "staffing"],
  fin: ["leads", "funnel"],
  sup: ["support"],
};
const TAB_LABEL = { outreach: "Approvals", pipeline: "Pipeline", leads: "Leads", admin: "Admin", hr: "People", support: "Tickets", activity: "Server log", funnel: "Funnel", performance: "Performance", staffing: "Staffing" };

function RoomModal({ roomKey, onClose, onSelect, leads, onAction }) {
  const room = ROOMS[roomKey];
  const tabs = ROOM_TABS[roomKey] || [];
  const [tab, setTab] = useState(tabs[0]);
  const mgr = sim.robots.get(roomKey === "exec" ? "ember" : `${roomKey}-m`);
  return (
    <Modal title={room.meeting ? `${room.name} meeting room` : room.name} sub={mgr ? `Managed by ${mgr.name} · ${mgr.title}` : undefined} onClose={onClose} wide>
      {roomKey === "cafe" ? <CafeView /> : roomKey === "conf" || ROOMS[roomKey].meeting ? <ConfView roomKey={roomKey} /> : (
        <>
          <TeamPanel dept={roomKey} onSelect={onSelect} />
          {TEAM_KEYS.includes(roomKey) && (
            <>
              <div className="lbl" style={{ marginBottom: 6 }}>Live systems this team owns</div>
              <TeamBoard dept={roomKey} onAction={onAction} />
            </>
          )}
        </>
      )}
      {tabs.length > 0 && (
        <>
          <div className="tabs" style={{ marginTop: 6 }}>
            {tabs.map((t) => <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
          </div>
          <div className="embedded">{tab === "funnel" ? <LeadFunnel leads={leads} /> : PAGES[tab].el(onAction)}</div>
        </>
      )}
    </Modal>
  );
}

function ClockBar() {
  useSimTick(4);
  const tod = todOf();
  const phase = tod < 510 ? "Before hours" : tod < 750 ? "Morning" : tod < 835 ? "Lunch hours" : tod < 1080 ? "Afternoon" : tod < 1140 ? "Wrapping up" : "After hours";
  const fast = sim.autoNight && isNight() && everyoneHome();
  return (
    <div className="clockbar">
      <div className="clock">
        <div className="clock-t">{fmtTime(sim.t)}</div>
        <div className="clock-d">{fmtDate()} · <span className="phase">{phase}</span>{fast && <span className="phase"> · ⏩ night fast-forward</span>}</div>
      </div>
      <div className="speed">
        <button className={`chip ${sim.paused ? "on" : ""}`} onClick={togglePause}>{sim.paused ? "▶ Resume" : "⏸ Pause"}</button>
        {SPEEDS.map((s) => (
          <button key={s} className={`chip ${sim.speed === s && !sim.paused ? "on" : ""}`} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
        {(isNight() || tod >= 1080) && <button className="chip" onClick={skipToMorning}>☀ Skip to morning</button>}
      </div>
    </div>
  );
}

// Scrub back through the day: the floor redraws from recorded frames.
function ReplayBar({ frame, setFrame }) {
  useSimTick(2);
  const [playing, setPlaying] = useState(false);
  const len = sim.history.length;
  useEffect(() => {
    if (!playing || frame == null) return;
    const id = setInterval(() => setFrame((f) => (f == null || f >= sim.history.length - 1 ? (setPlaying(false), f) : f + 1)), 220);
    return () => clearInterval(id);
  }, [playing, frame, setFrame]);
  if (len < 2) return null;
  const at = frame == null ? null : sim.history[Math.min(frame, len - 1)];
  return (
    <div className={`replay ${frame != null ? "on" : ""}`}>
      <button className="btn btn-ghost btn-sm" onClick={() => { setFrame(frame == null ? len - 1 : null); setPlaying(false); }}>
        {frame == null ? "⏪ Replay the day" : "✕ Back to live"}
      </button>
      {frame != null && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
          <input type="range" min={0} max={len - 1} value={Math.min(frame, len - 1)} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} />
          <span className="mono">{at ? fmtTime(at.t) : ""}</span>
          <span className="hint">{at ? `${at.stats.here} in the office · ${at.stats.done} tasks done · ${at.stats.incidents} incidents` : ""}</span>
        </>
      )}
    </div>
  );
}

function Kpis({ data, open }) {
  useSimTick(2);
  const [more, setMore] = useState(false);
  const all = robotsList();
  const here = all.filter((r) => r.visible);
  const n = (st) => here.filter((r) => statusOf(r) === st).length;
  const doneToday = Object.values(sim.deptDone).reduce((a, b) => a + b, 0);
  const primary = [
    { n: `${here.length}/${all.length}`, l: "In the office", hint: "Robots clocked in right now", onClick: () => open({ kind: "page", key: "hr" }) },
    { n: data.outreachAwaiting ?? "–", l: "Need your approval", hint: "Email drafts waiting on your desk", hot: data.outreachAwaiting > 0, onClick: () => open({ kind: "page", key: "outreach" }) },
    { n: sim.incidents.size, l: "Open incidents", hint: "Failing system checks the teams are fixing", hot: sim.incidents.size > 0, onClick: () => open({ kind: "page", key: "incidents" }) },
    { n: data.sentToday ?? "–", l: "Emails sent today", hint: "Approved and delivered over SMTP", onClick: () => open({ kind: "page", key: "outreach" }) },
    { n: doneToday, l: "Tasks done today", hint: "Finished by the whole office", onClick: () => open({ kind: "page", key: "performance" }) },
  ];
  const extra = [
    { n: n("busy"), l: "Working", hint: "On a task right now" },
    { n: n("break"), l: "On a break", hint: "Coffee or lunch" },
    { n: n("meeting"), l: "In meetings", hint: "Stand-ups, syncs and room bookings" },
    { n: data.leads ?? "–", l: "Leads", hint: "Total in the CRM", onClick: () => open({ kind: "page", key: "leads" }) },
    { n: data.openTickets ?? "–", l: "Open tickets", hint: "Support queue", onClick: () => open({ kind: "page", key: "support" }) },
  ];
  const tiles = more ? [...primary, ...extra] : primary;
  return (
    <div className="kpis">
      {tiles.map((t) => (
        <div key={t.l} className={`kpi ${t.onClick ? "click" : ""} ${t.hot ? "hot" : ""}`} onClick={t.onClick} title={t.hint}>
          <div className="n">{t.n}</div>
          <div className="l">{t.l}</div>
        </div>
      ))}
      <button className="kpi kpi-more" onClick={() => setMore((m) => !m)}>{more ? "Show less" : "More stats"}</button>
    </div>
  );
}

export default function Dashboard() {
  const { name } = useAuth();
  const [selected, setSelected] = useState(null);
  const [side, setSide] = useState("chat");
  const [chatWith, setChatWith] = useState(null);
  const [modal, setModal] = useState(null);
  const [data, setData] = useState({});
  const [leads, setLeads] = useState([]);
  const [digest, setDigest] = useState(null);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState(null);
  const [broadcast, setBroadcast] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [frame, setFrame] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState(null);
  const [sideOpen, setSideOpen] = useState(true);

  const openPage = useCallback((key) => setModal(PAGES[key] ? { kind: "page", key } : null), []);

  // Restore the saved office day (server-side), then keep saving it.
  useEffect(() => {
    let cancelled = false;
    api.officeState()
      .catch(() => null)
      .then((saved) => { if (!cancelled) startSim({ ceoName: (name || "Tanush").split(" ")[0], saved }); });
    return () => { cancelled = true; };
  }, [name]);

  useEffect(() => {
    const save = () => { api.saveOfficeState(exportState()).catch(() => {}); };
    const id = setInterval(save, SAVE_MS);
    window.addEventListener("beforeunload", save);
    return () => { clearInterval(id); window.removeEventListener("beforeunload", save); save(); };
  }, []);

  const pollActivity = useCallback(async (initial = false) => {
    try {
      const items = await api.activity(40);
      ingestActivity(items, { initial });
    } catch (err) { setError(err.message); }
  }, []);

  // Only what the pulse doesn't already carry: the org chart (robot names)
  // and the lead list behind the funnel.
  const pollData = useCallback(async () => {
    try {
      const [org, leadList] = await Promise.all([api.orgTree(), api.leads()]);
      applyOrgTree(org.root);
      setLeads(leadList);
      setError("");
    } catch (err) { setError(err.message); }
  }, []);

  const pollPulse = useCallback(async () => {
    try {
      const p = await api.companyPulse();
      ingestPulse(p);
      setPulse(p);
      sim.pendingApprovals = p.outreach.drafts;
      setData({
        leads: p.leads.total,
        outreachAwaiting: p.outreach.drafts,
        sentToday: p.outreach.sentToday,
        openTickets: p.tickets.open,
      });
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => {
    pollPulse();
    const id = setInterval(pollPulse, PULSE_POLL_MS);
    return () => clearInterval(id);
  }, [pollPulse]);

  useEffect(() => {
    pollActivity(sim.seenActivity.size === 0);
    pollData();
    api.digestLatest().then(setDigest).catch(() => {});
    const a = setInterval(() => pollActivity(false), ACTIVITY_POLL_MS);
    const d = setInterval(pollData, DATA_POLL_MS);
    // Pages opened in popups announce changes so the office reacts at once.
    const refresh = () => { pollActivity(false); pollData(); };
    window.addEventListener("vf:refresh", refresh);
    return () => { clearInterval(a); clearInterval(d); window.removeEventListener("vf:refresh", refresh); };
  }, [pollActivity, pollData]);

  const select = (id) => { setSelected(id); if (id) setSide("inspect"); };
  const openRoom = (key) => setModal({ kind: "room", key });

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="page-title">VexForge HQ <span className="live-dot" /> <span className="grad">Live Office</span></div>
          <div className="page-sub">Every robot, every desk, every task — click a robot, a room or your desk.</div>
        </div>
        <ClockBar />
      </div>

      {error && <div className="error-box">{error}</div>}
      <Kpis data={data} open={setModal} />

      <div className="dock">
        <button className="dock-btn primary" onClick={() => openPage("outreach")}>📥 Approvals {data.outreachAwaiting ? <b>{data.outreachAwaiting}</b> : null}</button>
        <button className={`dock-btn ${sim.incidents.size ? "danger" : ""}`} onClick={() => openPage("incidents")}>🚨 Incidents {sim.incidents.size ? <b>{sim.incidents.size}</b> : null}</button>
        <button className="dock-btn" onClick={() => openPage("systems")}>🩺 All systems</button>
        <button className="dock-btn" onClick={() => openPage("leads")}>🗂 Leads</button>
        <button className="dock-btn" onClick={() => openPage("hr")}>👥 People</button>
        <div className="dock-more">
          <button className="dock-btn" onClick={() => setMoreOpen((v) => !v)}>⋯ More {moreOpen ? "▴" : "▾"}</button>
          {moreOpen && (
            <div className="dock-menu" onMouseLeave={() => setMoreOpen(false)}>
              {[["pipeline", "🧭 Lead pipeline"], ["support", "🎧 Support tickets"], ["performance", "📊 Performance & morale"], ["staffing", "➕ Staffing"], ["activity", "📜 Server log"], ["admin", "⚙️ Admin"]].map(([k, label]) => (
                <button key={k} onClick={() => { openPage(k); setMoreOpen(false); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button className="dock-btn" onClick={() => setSideOpen((v) => !v)} title="Show or hide the side panel">{sideOpen ? "▶ Hide panel" : "◀ Show panel"}</button>
      </div>

      <Ticker />

      <div className="allhands">
        <span>📣 All-hands</span>
        <input value={broadcast} onChange={(e) => setBroadcast(e.target.value)} placeholder="Say something to the whole office…"
               onKeyDown={(e) => { if (e.key === "Enter" && broadcast.trim()) { announce(broadcast.trim()); setBroadcast(""); } }} />
        <button className="btn btn-molten btn-sm" disabled={!broadcast.trim()} onClick={() => { announce(broadcast.trim()); setBroadcast(""); }}>Call everyone in</button>
      </div>

      <div className="howto">
        <span>👆 Click a <b>robot</b> for everything it is doing · a <b>room</b> for that team's live systems · <b>your desk</b> for approvals · drag a task from <b>Backlog</b> onto any robot</span>
      </div>

      <div className={`office-wrap ${sideOpen ? "" : "solo"}`}>
        <div className="office-stage card">
          <ReplayBar frame={frame} setFrame={setFrame} />
          <OfficeFloor
            selectedId={selected}
            onSelect={select}
            onRoom={openRoom}
            onCeoDesk={() => openPage("outreach")}
            replay={frame == null ? null : sim.history[Math.min(frame, sim.history.length - 1)]}
            dragging={dragging}
            assignMode={picked}
            onDropTask={(taskId, robotId) => { const res = assignTaskTo(taskId, robotId); setDragging(false); setPicked(null); if (!res.ok) setError(res.why); }}
          />
          <DeskVisitor onAction={openPage} />
          <div className="legend">
            <span><i style={{ background: "#ff8a3d" }} />Working</span>
            <span><i style={{ background: "#8b93a1" }} />At desk</span>
            <span><i style={{ background: "#e6d23d" }} />Walking</span>
            <span><i style={{ background: "#3fb87f" }} />Break</span>
            <span><i style={{ background: "#6fa8ff" }} />Meeting</span>
            <span>⚡ Live task from the server</span>
          </div>
        </div>

        {sideOpen && <aside className="side card">
          <div className="side-tabs">
            <button className={side === "chat" ? "on" : ""} onClick={() => setSide("chat")}>💬 Managers</button>
            <button className={side === "inspect" ? "on" : ""} onClick={() => setSide("inspect")}>🔍 Inspector</button>
            <button className={side === "feed" ? "on" : ""} onClick={() => setSide("feed")}>⚡ Live feed</button>
            <button className={`${side === "ops" ? "on" : ""} ${sim.incidents.size ? "alarm" : ""}`} onClick={() => setSide("ops")}>🚨 Ops</button>
            <button className={side === "backlog" ? "on" : ""} onClick={() => setSide("backlog")}>🗒 Backlog</button>
          </div>
          <div className="side-body">
            {side === "chat" && <ManagerChat initial={chatWith} />}
            {side === "inspect" && <Inspector id={selected} onSelect={select} />}
            {side === "feed" && <Feed onSelect={select} />}
            {side === "backlog" && <div className="side-scroll"><Backlog onDragState={setDragging} picked={picked} onPick={setPicked} /></div>}
            {side === "ops" && (
              <div className="side-scroll">
                <div className="lbl">Open incidents</div>
                <Incidents onAction={openPage} />
                <div className="lbl" style={{ marginTop: 14 }}>Hiring requests</div>
                <HiringRequests />
              </div>
            )}
          </div>
        </aside>}
      </div>

      <Roster selectedId={selected} onSelect={select} />

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <LeadFunnel leads={leads} />
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <strong>Weekly digest</strong>
            {digest && <span className="hint">{new Date(digest.periodStart).toLocaleDateString()} – {new Date(digest.periodEnd).toLocaleDateString()}</span>}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--fog)", whiteSpace: "pre-wrap" }}>{digest?.text || "No digest yet — it's generated weekly."}</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setChatWith("hr-m"); setSide("chat"); }}>Ask HR for today's status →</button>
        </div>
      </div>

      {modal?.kind === "page" && (
        <Modal title={PAGES[modal.key].title} sub={PAGES[modal.key].sub} onClose={() => setModal(null)} wide>
          <div className="embedded">{PAGES[modal.key].el(openPage)}</div>
        </Modal>
      )}
      {modal?.kind === "room" && (
        <RoomModal roomKey={modal.key} leads={leads} onAction={openPage} onClose={() => setModal(null)} onSelect={(id) => { select(id); setModal(null); }} />
      )}
      <Toasts />
    </div>
  );
}
