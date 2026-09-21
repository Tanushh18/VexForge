import { useEffect, useState } from "react";
import { api } from "../services/api.js";

// Polls fast while a run is live (the worker reports a new stage every few
// seconds) and slowly when idle, where the only thing changing is whether the
// worker is still checking in.
const POLL_ACTIVE_MS = 2000;
const POLL_IDLE_MS = 10000;

const STAGES = [
  { key: "discover", label: "Discover" },
  { key: "enrich", label: "Find emails" },
  { key: "score", label: "Score" },
  { key: "draft", label: "Draft" },
];

function Stat({ label, value, tone }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 130 }}>
      <div className="hint">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: tone || "var(--snow)" }}>{value}</div>
    </div>
  );
}

// A queued job with no worker online is the single most likely confusion —
// it looks identical to "nothing is happening" unless we say so outright.
function WorkerBadge({ worker }) {
  if (!worker) return null;
  if (!worker.configured) {
    return (
      <span className="pill pill-failed" title="Set WORKER_API_KEY on the server and in worker/.env">
        worker API disabled
      </span>
    );
  }
  if (!worker.anyOnline) {
    const last = worker.workers?.[0];
    return (
      <span className="pill pill-failed" title={last ? `Last seen ${new Date(last.lastSeenAt).toLocaleString()}` : "No worker has ever checked in"}>
        no worker connected
      </span>
    );
  }
  const online = worker.workers.filter((w) => w.online);
  return (
    <span className="pill pill-done" title={online.map((w) => `${w.workerId} — ${new Date(w.lastSeenAt).toLocaleTimeString()}`).join("\n")}>
      {online.length === 1 ? `worker: ${online[0].workerId}` : `${online.length} workers online`}
    </span>
  );
}

// The live strip: which stage the worker is in, what it's doing right now, and
// how far along. Without this a run is an opaque several-minute wait.
function LiveRun({ run, worker }) {
  if (!run) return null;
  const waiting = run.status === "queued";
  const currentIdx = STAGES.findIndex((s) => s.key === run.stage);

  return (
    <div className="panel" style={{ marginBottom: 20, borderColor: "var(--molten)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600 }}>
          {waiting ? "Queued" : "Run in progress"}
          <span className="hint" style={{ marginLeft: 8 }}>
            started {new Date(run.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <WorkerBadge worker={worker} />
      </div>

      {waiting && !worker?.anyOnline ? (
        <div className="hint">
          Waiting for a worker to pick this up — nothing is running yet. Start it on your machine with{" "}
          <code>cd worker &amp;&amp; npm start</code>.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {STAGES.map((s, i) => {
              const done = currentIdx > i;
              const active = currentIdx === i;
              return (
                <span
                  key={s.key}
                  className="pill"
                  style={{
                    background: active ? "var(--molten)" : done ? "var(--iron-2)" : "transparent",
                    color: active ? "#12100e" : done ? "var(--snow)" : "var(--muted)",
                    border: "1px solid var(--line)",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {done ? "✓ " : ""}
                  {s.label}
                </span>
              );
            })}
          </div>

          <div style={{ height: 6, background: "var(--iron-2)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${run.percent || 0}%`, height: "100%", background: "var(--molten)", transition: "width .4s ease" }} />
          </div>

          <div style={{ fontSize: 14 }}>{run.note || "Working…"}</div>
          <div className="hint" style={{ marginTop: 6 }}>
            {run.stats?.discovered || 0} found · {run.stats?.enriched || 0} with emails · {run.stats?.created || 0} new ·{" "}
            {run.stats?.duplicates || 0} duplicate · {run.stats?.drafted || 0} drafted
          </div>
        </>
      )}
    </div>
  );
}

export default function Pipeline() {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState([]);
  const [opts, setOpts] = useState({ perSource: 12, enrich: true, useModelScoring: true, autoDraftTop: 5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [s, r] = await Promise.all([api.pipelineStatus(), api.pipelineRuns()]);
    setStatus(s);
    setRuns(r);
  }

  useEffect(() => {
    api.pipelineSources().then((d) => {
      setSources(d.sources);
      setSelected(d.sources.map((x) => x.key));
      setOpts((o) => ({ ...o, ...d.defaults }));
    });
    load();
  }, []);

  useEffect(() => {
    const id = setInterval(load, status?.running ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [status?.running]);

  function toggleSource(key) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      await api.runPipeline({ ...opts, sources: selected });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function rescore() {
    setBusy(true);
    setError("");
    try {
      await api.rescoreLeads(true);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const bands = status?.bands || {};
  const quota = status?.quota;

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Lead Pipeline</div>
        <div className="page-sub">
          Discover → find emails → score → draft. The crawl runs on your machine (see{" "}
          <code>worker/</code>) because it needs a real browser and the local models; results land here.
          The pipeline stops at <strong>draft</strong> — nothing is sent without your approval, and sends
          are capped daily to protect deliverability.
        </div>
      </div>

      <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Hot leads" value={bands.hot || 0} tone="var(--molten)" />
        <Stat label="Warm" value={bands.warm || 0} />
        <Stat label="Cold" value={bands.cold || 0} />
        <Stat label="Sends left today" value={quota ? `${quota.remaining}/${quota.cap}` : "—"} />
      </div>

      <LiveRun run={status?.activeRun} worker={status?.worker} />

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600 }}>Run the pipeline</div>
          {!status?.activeRun && <WorkerBadge worker={status?.worker} />}
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          {sources.map((s) => (
            <label key={s.key} className="hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggleSource(s.key)} />
              {s.label}{s.needsBrowser ? " (browser)" : ""}
            </label>
          ))}
        </div>

        <div className="row">
          <div className="field">
            <label>Per source</label>
            <input type="number" min="1" max="50" value={opts.perSource}
              onChange={(e) => setOpts({ ...opts, perSource: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Auto-draft top N</label>
            <input type="number" min="0" max="25" value={opts.autoDraftTop}
              onChange={(e) => setOpts({ ...opts, autoDraftTop: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Options</label>
            <div style={{ display: "flex", gap: 14, paddingTop: 8 }}>
              <label className="hint" style={{ display: "flex", gap: 6 }}>
                <input type="checkbox" checked={opts.enrich} onChange={(e) => setOpts({ ...opts, enrich: e.target.checked })} />
                Find emails
              </label>
              <label className="hint" style={{ display: "flex", gap: 6 }}>
                <input type="checkbox" checked={opts.useModelScoring} onChange={(e) => setOpts({ ...opts, useModelScoring: e.target.checked })} />
                Model scoring
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-molten" disabled={busy || status?.running || !selected.length} onClick={start}>
            {status?.running ? "Run in progress…" : busy ? "Queueing…" : "Start run"}
          </button>
          <button className="btn" disabled={busy || status?.running} onClick={rescore}>Re-score CRM</button>
          {!status?.worker?.anyOnline && status?.worker?.configured && (
            <span className="hint">Queueing works, but nothing runs until a worker is online.</span>
          )}
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      {status?.latestRun?.summary && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="hint" style={{ marginBottom: 6 }}>Latest run — what the reasoning model made of it</div>
          <div>{status.latestRun.summary}</div>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="empty">No pipeline runs yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>When</th><th>Trigger</th><th>Status</th><th>Found</th><th>New</th><th>Emails</th><th>Hot</th><th>Drafted</th><th>Sources</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r._id}>
                <td className="hint">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="hint">{r.trigger}</td>
                <td>
                  <span className={`pill pill-${r.status}`}>{r.status}</span>
                  {["queued", "claimed", "running"].includes(r.status) && r.stage !== "queued" && (
                    <div className="hint">{r.stage}</div>
                  )}
                </td>
                <td>{r.stats?.discovered ?? 0}</td>
                <td style={{ fontWeight: 600 }}>{r.stats?.created ?? 0}</td>
                <td>{r.stats?.enriched ?? 0}</td>
                <td style={{ color: "var(--molten)" }}>{r.stats?.hot ?? 0}</td>
                <td>{r.stats?.drafted ?? 0}</td>
                <td className="hint">
                  {r.status === "failed"
                    ? r.error
                    : (r.sourceResults || []).map((s) => `${s.source}: ${s.ok ? s.found : "failed"}`).join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
