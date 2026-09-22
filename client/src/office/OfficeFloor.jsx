import { memo, useEffect, useRef, useState } from "react";
import {
  sim, subscribe, WORLD, ROOMS, TEAM_KEYS, CEO_DESK, EMBER_DESK, COFFEE_MACHINE, FOOD_COUNTER, CAFE_TABLES, CONF_TABLE,
  managerDesk, workerDesks, MEETING_ROOMS, meetingTable, robotsList, statusOf, isBirthday, todOf, activityText, RACKS, SERVER_CONSOLE, MOODS,
} from "./sim.js";

const STATUS_COLOR = { busy: "#ff8a3d", idle: "#8b93a1", walking: "#e6d23d", break: "#3fb87f", meeting: "#6fa8ff", off: "#3a4150" };

function Desk({ x, y, w = 54, accent }) {
  return (
    <g>
      <circle cx={x} cy={y + 27} r={9} fill="var(--of-chair)" />
      <rect x={x - w / 2} y={y - 13} width={w} height={26} rx={4} fill="var(--of-desk)" stroke="var(--of-desk-edge)" />
      <rect x={x - 11} y={y - 10} width={22} height={13} rx={2} fill="#0b0e13" stroke={accent} strokeWidth={1} />
      <rect x={x - 9} y={y - 8} width={18} height={9} rx={1} fill={accent} opacity={0.35} />
    </g>
  );
}

function Plant({ x, y }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill="#1f5a3a" />
      <circle cx={x - 5} cy={y - 4} r={6} fill="#2f7d52" />
      <circle cx={x + 5} cy={y - 2} r={6} fill="#3a9463" />
      <rect x={x - 6} y={y + 8} width={12} height={8} rx={2} fill="#6b4a33" />
    </g>
  );
}

// Everything that doesn't move. Re-rendered only when desks change.
const Floor = memo(function Floor({ version, onRoom }) {
  return (
    <g>
      <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="var(--of-bg)" />
      {/* corridor */}
      <rect x={0} y={340} width={WORLD.w} height={140} fill="var(--of-corridor)" />
      {Array.from({ length: 35 }, (_, i) => (
        <rect key={i} x={20 + i * 50} y={408} width={26} height={3} rx={1.5} fill="var(--of-lane)" />
      ))}
      <text x={8} y={372} className="of-small">ENTRANCE</text>
      <rect x={0} y={386} width={6} height={50} fill="var(--m2)" opacity={0.8} />

      {Object.values(ROOMS).map((r) => {
        const doorX = r.x + r.w / 2;
        const doorY = r.top ? r.y + r.h : r.y;
        return (
          <g key={r.key} className="of-room" onClick={() => onRoom(r.key)}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} fill="var(--of-room)" stroke={r.color} strokeOpacity={0.55} strokeWidth={3} />
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} fill={r.color} opacity={0.1} />
            <rect x={doorX - 22} y={doorY - 3} width={44} height={6} fill="var(--of-corridor)" />
            <rect x={r.x + 10} y={r.top ? r.y + 10 : r.y + r.h - 40} width={Math.min(r.w - 20, 34 + r.name.length * 10)} height={30} rx={8} fill="var(--of-tag)" stroke={r.color} strokeOpacity={0.6} />
            <circle cx={r.x + 25} cy={r.top ? r.y + 25 : r.y + r.h - 25} r={6} fill={r.color} />
            <text x={r.x + 37} y={r.top ? r.y + 31 : r.y + r.h - 19} className="of-room-label">{r.name}</text>
          </g>
        );
      })}

      {/* executive suite */}
      <Desk x={CEO_DESK.x} y={CEO_DESK.y} w={70} accent="#ffffff" />
      <Desk x={EMBER_DESK.x} y={EMBER_DESK.y} w={62} accent="#ff7a2e" />
      <rect x={50} y={225} width={90} height={26} rx={10} fill="#3b2f4a" />
      <rect x={50} y={218} width={90} height={10} rx={5} fill="#4a3b5c" />
      <rect x={165} y={230} width={40} height={20} rx={4} fill="var(--of-desk)" />
      <Plant x={300} y={60} />
      <Plant x={300} y={300} />

      {/* team rooms */}
      {TEAM_KEYS.map((k) => (
        <g key={k} pointerEvents="none">
          <Desk x={managerDesk(k).x} y={managerDesk(k).y} w={66} accent={ROOMS[k].color} />
          {workerDesks(k, sim.counts[k]).map((d, i) => <Desk key={i} x={d.x} y={d.y} accent={ROOMS[k].color} />)}
          <rect x={ROOMS[k].x + ROOMS[k].w - 52} y={ROOMS[k].top ? ROOMS[k].y + 14 : ROOMS[k].y + ROOMS[k].h - 60} width={40} height={46} rx={3} fill="#e8edf3" opacity={0.12} />
          <Plant x={ROOMS[k].x + 22} y={ROOMS[k].top ? ROOMS[k].y + ROOMS[k].h - 30 : ROOMS[k].y + 34} />
        </g>
      ))}

      {/* conference */}
      <g pointerEvents="none">
        <rect x={CONF_TABLE.x - CONF_TABLE.w / 2} y={CONF_TABLE.y - CONF_TABLE.h / 2} width={CONF_TABLE.w} height={CONF_TABLE.h} rx={30} fill="var(--of-desk)" stroke="var(--of-desk-edge)" />
        <rect x={1150} y={70} width={120} height={8} rx={3} fill="#e8edf3" opacity={0.25} />
        <text x={1210} y={92} textAnchor="middle" className="of-small">SCREEN</text>
        <Plant x={1345} y={300} />
      </g>

      {/* cricketer meeting rooms */}
      {MEETING_ROOMS.map((k) => {
        const t = meetingTable(k);
        return (
          <g key={k} pointerEvents="none">
            <rect x={t.x - t.w / 2} y={t.y - t.h / 2} width={t.w} height={t.h} rx={14} fill="var(--of-desk)" stroke="var(--of-desk-edge)" />
            {[-45, 0, 45].map((dy) => (
              <g key={dy}><circle cx={t.x - 42} cy={t.y + dy} r={8} fill="var(--of-chair)" /><circle cx={t.x + 42} cy={t.y + dy} r={8} fill="var(--of-chair)" /></g>
            ))}
            <rect x={t.x - 30} y={ROOMS[k].top ? ROOMS[k].y + 52 : ROOMS[k].y + ROOMS[k].h - 58} width={60} height={6} rx={3} fill="#e8edf3" opacity={0.25} />
          </g>
        );
      })}

      {/* server room — LEDs follow the Tech team's live checks */}
      <g pointerEvents="none">
        {RACKS.map((k, i) => (
          <g key={i}>
            <rect x={k.x - 20} y={k.y - 34} width={40} height={130} rx={5} fill="#141b24" stroke="#38505e" />
            {Array.from({ length: 6 }, (_, j) => {
              const checks = sim.pulse?.teams?.tech?.checks || [];
              const c = checks[(i * 6 + j) % Math.max(1, checks.length)];
              const col = !checks.length ? "#3a4150" : c.state === "down" ? "#ff5a4f" : c.state === "warn" ? "#e6b23d" : c.state === "off" ? "#3a4150" : "#3fb87f";
              return <g key={j}><rect x={k.x - 15} y={k.y - 28 + j * 20} width={30} height={13} rx={2} fill="#0c1117" /><circle cx={k.x + 9} cy={k.y - 21.5 + j * 20} r={2.6} fill={col} className={c?.state === "down" ? "of-blink" : ""} /></g>;
            })}
          </g>
        ))}
        <rect x={SERVER_CONSOLE.x - 34} y={SERVER_CONSOLE.y - 16} width={68} height={28} rx={4} fill="var(--of-desk)" stroke="var(--of-desk-edge)" />
        <rect x={SERVER_CONSOLE.x - 14} y={SERVER_CONSOLE.y - 12} width={28} height={16} rx={2} fill="#0b0e13" stroke="#5fd3c4" />
      </g>

      {/* cafeteria */}
      <g pointerEvents="none">
        <rect x={COFFEE_MACHINE.x - 22} y={COFFEE_MACHINE.y - 16} width={70} height={30} rx={5} fill="#5a3b28" />
        <rect x={COFFEE_MACHINE.x - 16} y={COFFEE_MACHINE.y - 12} width={18} height={20} rx={3} fill="#222" />
        <circle cx={COFFEE_MACHINE.x + 20} cy={COFFEE_MACHINE.y - 2} r={6} fill="#c98a5a" />
        <text x={COFFEE_MACHINE.x + 12} y={COFFEE_MACHINE.y + 30} textAnchor="middle" className="of-small">COFFEE BAR</text>
        {CAFE_TABLES.map((t, i) => (
          <g key={i}>
            <circle cx={t.x} cy={t.y} r={17} fill="var(--of-desk)" stroke="var(--of-desk-edge)" />
            <circle cx={t.x} cy={t.y} r={4} fill="#c98a5a" opacity={0.6} />
          </g>
        ))}
        <rect x={FOOD_COUNTER.x} y={FOOD_COUNTER.y} width={FOOD_COUNTER.w} height={FOOD_COUNTER.h} rx={4} fill="#5a3b28" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={FOOD_COUNTER.x + 20 + i * 45} y={FOOD_COUNTER.y + 3} width={30} height={12} rx={3} fill="#e0b04f" opacity={0.5} />)}
        <text x={FOOD_COUNTER.x + FOOD_COUNTER.w / 2} y={FOOD_COUNTER.y - 6} textAnchor="middle" className="of-small">FOOD COUNTER</text>
      </g>
    </g>
  );
});

function Robot({ r, selected, onSelect, onDropTask, dragging, assignMode }) {
  const status = statusOf(r);
  const walking = r.path.length > 0;
  const bday = isBirthday(r);
  const isMgr = r.role === "manager" || r.role === "head";
  const chatting = r.chatUntil && r.chatUntil >= sim.t;
  const bubble = chatting ? "💬" : { break: r.mode === "lunch" ? "🍽" : "☕", meeting: "💬" }[status] || (r.task?.live ? "⚡" : null);
  const mood = MOODS[r.mood]?.emoji;
  return (
    <g
      transform={`translate(${r.pos.x.toFixed(1)},${r.pos.y.toFixed(1)})`}
      className={`robot ${walking ? "walking" : ""}`}
      onClick={(e) => { e.stopPropagation(); if (assignMode && r.role !== "staff") onDropTask?.(assignMode, r.id); else onSelect(r.id); }}
      onDragOver={(e) => { if (dragging && r.role !== "staff") { e.preventDefault(); e.currentTarget.classList.add("drop-ok"); } }}
      onDragLeave={(e) => e.currentTarget.classList.remove("drop-ok")}
      onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("drop-ok"); onDropTask?.(e.dataTransfer.getData("text/task"), r.id); }}
      style={{ cursor: "pointer" }}
    >
      {(dragging || assignMode) && r.role !== "staff" && <circle cx={0} cy={-8} r={24} className="drop-ring" />}
      <g transform="scale(1.45)">
      <ellipse cx={0} cy={11} rx={10} ry={3.5} fill="#000" opacity={0.35} />
      {selected && <circle cx={0} cy={-6} r={21} fill="none" stroke="var(--m1)" strokeWidth={2} strokeDasharray="4 3" className="of-spin" />}
      <g transform={`scale(${r.dir < 0 ? -1 : 1},1)`}>
        <rect className="leg l" x={-6} y={3} width={4} height={8} rx={2} fill="#59616e" />
        <rect className="leg r" x={2} y={3} width={4} height={8} rx={2} fill="#59616e" />
        <rect x={-9} y={-10} width={18} height={15} rx={5} fill={r.color} stroke="#0008" />
        {isMgr && <rect x={-2} y={-9} width={4} height={10} rx={1} fill="#1a0d05" opacity={0.6} />}
        <rect x={-8} y={-24} width={16} height={13} rx={4} fill="#dfe6ee" stroke="#0006" />
        <rect x={-6} y={-21} width={12} height={6} rx={3} fill="#12161d" />
        <circle className="eye" cx={-2.5} cy={-18} r={1.4} fill={STATUS_COLOR[status]} />
        <circle className="eye" cx={2.5} cy={-18} r={1.4} fill={STATUS_COLOR[status]} />
        <line x1={0} y1={-24} x2={0} y2={-29} stroke="#8b93a1" strokeWidth={1.4} />
        <circle cx={0} cy={-30} r={2.2} fill={STATUS_COLOR[status]} className={status === "busy" ? "of-blink" : ""} />
        {r.role === "staff" && <rect x={-7} y={-28} width={14} height={5} rx={2} fill="#fff" />}
        {r.isIntern && <rect x={-8} y={-27} width={16} height={4} rx={2} fill="#ffd34f" />}
      </g>
      {bday && <text x={13} y={-34} fontSize={13}>🎂</text>}
      {mood && (r.mood === "stressed" || r.mood === "proud") && <text x={-26} y={-30} fontSize={13}>{mood}</text>}
      {bubble && (
        <g transform="translate(-24,-40)">
          <rect width={16} height={15} rx={5} fill="var(--of-tag)" />
          <text x={8} y={11.5} fontSize={9.5} textAnchor="middle">{bubble}</text>
        </g>
      )}
      </g>
      <text y={36} textAnchor="middle" className="of-name">{r.name}</text>
    </g>
  );
}

function clampView(v) {
  const w = Math.min(WORLD.w, Math.max(320, v.w));
  const h = (w * WORLD.h) / WORLD.w;
  return { w, h, x: Math.min(WORLD.w - w, Math.max(0, v.x)), y: Math.min(WORLD.h - h, Math.max(0, v.y)) };
}
const FULL = { x: 0, y: 0, w: WORLD.w, h: WORLD.h };

// What the selected robot is doing, drawn above its head on the floor.
function SpeechBubble({ r }) {
  const text = activityText(r);
  const line = text.length > 56 ? `${text.slice(0, 55)}…` : text;
  const w = Math.max(90, line.length * 7.1 + 24);
  const x = Math.min(WORLD.w - w - 6, Math.max(6, r.pos.x - w / 2));
  const y = Math.max(6, r.pos.y - 92);
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={44} rx={10} fill="#fff" stroke="var(--m2)" strokeWidth={2} />
      <path d={`M${r.pos.x - 7} ${y + 44} l7 9 l7 -9 z`} fill="#fff" />
      <text x={x + 12} y={y + 17} className="of-bubble-name">{r.name} · {r.title}</text>
      <text x={x + 12} y={y + 34} className="of-bubble-text">{line}</text>
    </g>
  );
}

export default function OfficeFloor({ selectedId, onSelect, onRoom, onCeoDesk, replay, onDropTask, dragging, assignMode }) {
  const [, force] = useState(0);
  const [view, setView] = useState(FULL);
  const [follow, setFollow] = useState(false);
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const drag = useRef(null);
  useEffect(() => subscribe(() => force((n) => (n + 1) % 1e9)), []);

  const selected = selectedId && sim.robots.get(selectedId);
  let vb = view;
  if (follow && selected?.visible) vb = clampView({ ...view, x: selected.pos.x - view.w / 2, y: selected.pos.y - view.h / 2 });

  const tod = todOf();
  // Darkness ramps in after 18:00 and out before 08:00.
  const dark = tod >= 1080 ? Math.min(0.5, ((tod - 1080) / 120) * 0.5) : tod < 480 ? Math.min(0.5, ((480 - tod) / 60) * 0.5) : 0;

  function toWorld(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: vb.x + ((e.clientX - rect.left) / rect.width) * vb.w, y: vb.y + ((e.clientY - rect.top) / rect.height) * vb.h };
  }
  function zoom(factor, center) {
    const c = center || { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
    const w = vb.w * factor;
    const h = (w * WORLD.h) / WORLD.w;
    setView(clampView({ w, h, x: c.x - ((c.x - vb.x) / vb.w) * w, y: c.y - ((c.y - vb.y) / vb.h) * h }));
  }
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) return; // plain scroll still scrolls the page
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toWorld(e));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onDown(e) {
    drag.current = { sx: e.clientX, sy: e.clientY, v: vb, moved: false };
  }
  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved || d.v.w >= WORLD.w) return;
    const rect = svgRef.current.getBoundingClientRect();
    setFollow(false);
    setView(clampView({ ...d.v, x: d.v.x - (dx / rect.width) * d.v.w, y: d.v.y - (dy / rect.height) * d.v.h }));
  }
  function onUp() {
    setTimeout(() => { drag.current = null; }, 0);
  }
  // Swallow the click that ends a drag so panning doesn't open rooms.
  const guard = (e) => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault(); } };

  function focusRoom(key) {
    const r = ROOMS[key];
    const w = Math.max(r.w + 120, ((r.h + 70) * WORLD.w) / WORLD.h);
    const h = (w * WORLD.h) / WORLD.w;
    setFollow(false);
    setView(clampView({ w, h, x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2 }));
  }
  function fullscreen() {
    const el = wrapRef.current;
    if (document.fullscreenElement) document.exitFullscreen();
    else el?.requestFullscreen?.();
  }

  return (
    <div className="floor-wrap" ref={wrapRef}>
      <div className="floor-bar">
        <div className="floor-rooms">
          <select className="room-jump" value="" onChange={(e) => e.target.value && focusRoom(e.target.value)}>
            <option value="">🔍 Zoom to a room…</option>
            {Object.values(ROOMS).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
          <span className="floor-hint">Drag to pan · ⌘/Ctrl + scroll to zoom</span>
        </div>
        <div className="floor-ctrl">
          <button onClick={() => zoom(1 / 1.3)} title="Zoom in">＋</button>
          <button onClick={() => zoom(1.3)} title="Zoom out">－</button>
          <button onClick={() => { setFollow(false); setView(FULL); }} title="Show the whole office">⤢</button>
          <button className={follow ? "on" : ""} disabled={!selected} onClick={() => { setFollow((f) => !f); if (view.w > 700) setView(clampView({ ...view, w: 560 })); }} title="Follow the selected robot">🎯</button>
          <button onClick={fullscreen} title="Full screen">⛶</button>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className={`office-svg ${vb.w < WORLD.w ? "zoomed" : ""}`}
        onClickCapture={guard}
        onClick={() => onSelect(null)}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
      >
        <Floor version={sim.version} onRoom={onRoom} />

        {/* your desk */}
        <g className="of-ceo" onClick={(e) => { e.stopPropagation(); onCeoDesk(); }}>
          <g transform={`translate(${CEO_DESK.x},${CEO_DESK.y - 14}) scale(1.5)`}>
            <circle cx={0} cy={-16} r={8} fill="#f2d3b3" stroke="#0006" />
            <path d="M-12 4 q12 -18 24 0 z" fill="#fff" />
          </g>
          <text x={CEO_DESK.x} y={CEO_DESK.y - 58} textAnchor="middle" className="of-name of-ceo-name">{sim.ceoName} (You)</text>
          {sim.pendingApprovals > 0 && (
            <g transform={`translate(${CEO_DESK.x + 32},${CEO_DESK.y - 30})`} className="of-pulse">
              <rect x={0} y={-14} width={46} height={26} rx={13} fill="var(--m3)" />
              <text x={23} y={4.5} textAnchor="middle" className="of-badge">📥 {sim.pendingApprovals}</text>
            </g>
          )}
        </g>

        {(replay
          ? replay.robots.map((f) => {
              const base = sim.robots.get(f.id);
              return base && { ...base, pos: { x: f.x, y: f.y }, mode: f.m, mood: f.mood, activity: f.a, path: f.w ? [1] : [] };
            }).filter(Boolean)
          : robotsList().filter((r) => r.visible)
        ).sort((a, b) => a.pos.y - b.pos.y).map((r) => (
          <Robot key={r.id} r={r} selected={r.id === selectedId} onSelect={onSelect} onDropTask={onDropTask} dragging={dragging} assignMode={assignMode} />
        ))}
        {!replay && selected?.visible && <SpeechBubble r={selected} />}

        {dark > 0 && <rect x={0} y={0} width={WORLD.w} height={WORLD.h} fill="#02040a" opacity={dark} pointerEvents="none" />}
      </svg>
    </div>
  );
}
