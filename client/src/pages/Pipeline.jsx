import { useEffect, useState } from "react";
import { api } from "../services/api.js";

// Polls while a run is in flight — a full crawl takes minutes, so the page
// has to show progress rather than hanging on one request.
const POLL_MS = 4000;

function Stat({ label, value, tone }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 130 }}>
      <div className="hint">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: tone || "var(--snow)" }}>{value}</div>
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
    if (!status?.running) return undefined;
    const id = setInterval(load, POLL_MS);
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
          Discover → dedupe → enrich → score → draft. Sources are public listing pages only; contact
          emails come from each company's own site. The pipeline stops at <strong>draft</strong> —
          nothing is sent without your approval, and sends are capped daily to protect deliverability.
        </div>
      </div>

      <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Hot leads" value={bands.hot || 0} tone="var(--molten)" />
        <Stat label="Warm" value={bands.warm || 0} />
        <Stat label="Cold" value={bands.cold || 0} />
        <Stat label="Sends left today" value={quota ? `${quota.remaining}/${quota.cap}` : "—"} />
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Run the pipeline</div>

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

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button className="btn btn-molten" disabled={busy || status?.running || !selected.length} onClick={start}>
            {status?.running ? "Run in progress…" : busy ? "Starting…" : "Start run"}
          </button>
          <button className="btn" disabled={busy || status?.running} onClick={rescore}>Re-score CRM</button>
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
            <tr><th>When</th><th>Trigger</th><th>Status</th><th>Found</th><th>New</th><th>Enriched</th><th>Hot</th><th>Drafted</th><th>Sources</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r._id}>
                <td className="hint">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="hint">{r.trigger}</td>
                <td><span className={`pill pill-${r.status}`}>{r.status}</span></td>
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
