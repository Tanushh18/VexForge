import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const POLL_MS = 3000;

export default function Admin() {
  const [jobs, setJobs] = useState([]);
  const [models, setModels] = useState(null);
  const [bgJobs, setBgJobs] = useState([]);
  const [worker, setWorker] = useState(null);
  const [githubTrigger, setGithubTrigger] = useState(null);
  const [form, setForm] = useState({ companyName: "", domain: "", industry: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setJobs(await api.scrapeJobs());
  }

  // Model and background-job state change on their own schedule, not with the
  // scan-job poll, so they load separately and refresh far less often.
  async function loadSystem() {
    const [m, j, p] = await Promise.all([
      api.models().catch(() => null),
      api.jobs().catch(() => []),
      api.pipelineStatus().catch(() => null),
    ]);
    setModels(m);
    setBgJobs(j);
    setWorker(p?.worker || null);
    setGithubTrigger(p?.githubTrigger || null);
  }

  useEffect(() => {
    loadSystem();
    const id = setInterval(loadSystem, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function runScan(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createScrapeJob(form);
      setForm({ companyName: "", domain: "", industry: "" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Admin · System</div>
        <div className="page-sub">
          Local models, background jobs, and Playwright-driven deep contact scans for JS-rendered sites
          the fast scanner on the CRM page can't see.
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Local models {models?.backend ? <span className="pill pill-done">{models.backend}</span> : <span className="pill pill-failed">offline</span>}
        </div>
        {!models?.backend ? (
          <div className="hint">
            No Groq API key configured. Set <code>GROQ_API_KEYS</code> (comma-separated, one or more free-tier
            keys) in this server's environment — the app still runs, but drafting, scoring and the chatbot stay
            off until it's set.
          </div>
        ) : (
          <>
            <table className="table">
              <thead><tr><th>Role</th><th>Model</th><th>Status</th></tr></thead>
              <tbody>
                {(models.roles || []).map((r) => (
                  <tr key={r.role}>
                    <td style={{ fontWeight: 600 }}>{r.role}</td>
                    <td className="hint">{r.model}</td>
                    <td><span className={`pill pill-${r.available ? "done" : "failed"}`}>{r.available ? "ready" : "unavailable"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint" style={{ marginTop: 8 }}>
              {models.keyCount} Groq key(s) configured · currently using key #{(models.activeKeyIndex ?? 0) + 1}
            </div>
          </>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Background jobs</div>
        <table className="table">
          <thead><tr><th>Job</th><th>Every</th><th>Enabled</th><th>Last run</th><th>Outcome</th><th></th></tr></thead>
          <tbody>
            {bgJobs.map((j) => (
              <tr key={j.key}>
                <td style={{ fontWeight: 600 }}>{j.label}</td>
                <td className="hint">{Math.round(j.everyMs / 60000)} min</td>
                <td><span className={`pill pill-${j.enabled ? "done" : "default"}`}>{j.enabled ? "on" : "off"}</span></td>
                <td className="hint">{j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "never"}</td>
                <td className="hint">{j.lastError ? j.lastError : j.lastOk === true ? "ok" : "—"}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => api.runJob(j.key).then(loadSystem)}>Run now</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>Deep contact scan</span>
        <span className={`pill pill-${worker?.anyOnline ? "done" : "failed"}`}>
          {worker?.anyOnline ? "worker online" : "no worker connected"}
        </span>
      </div>
      {!worker?.anyOnline && (
        <div className="hint" style={{ marginBottom: 10 }}>
          Chromium runs on your machine, not here — a scan queued now will sit until the worker starts
          (<code>cd worker &amp;&amp; npm start</code>).
        </div>
      )}

      {githubTrigger?.configured && (
        <div className="hint" style={{ marginBottom: 14 }}>
          GitHub Actions instant-trigger:{" "}
          {githubTrigger.lastTriggerAt ? (
            <span className={githubTrigger.lastOk ? "" : "error-box"} style={{ display: "inline" }}>
              {githubTrigger.lastOk ? "last wake succeeded" : `last wake failed — ${githubTrigger.lastError}`} (
              {new Date(githubTrigger.lastTriggerAt).toLocaleString()})
            </span>
          ) : (
            "configured, not triggered yet"
          )}
        </div>
      )}

      <form className="panel" onSubmit={runScan} style={{ marginBottom: 20 }}>
        <div className="row">
          <div className="field">
            <label>Company name *</label>
            <input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </div>
          <div className="field">
            <label>Domain *</label>
            <input required placeholder="example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          </div>
          <div className="field">
            <label>Industry</label>
            <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-molten" disabled={busy}>{busy ? "Queuing…" : "Run deep scan"}</button>
      </form>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      {jobs.length === 0 ? (
        <div className="empty">No scan jobs yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Company</th><th>Domain</th><th>Status</th><th>Tier</th><th>Result</th><th>When</th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j._id}>
                <td style={{ fontWeight: 600 }}>{j.companyName}</td>
                <td className="hint">{j.domain}</td>
                <td><span className={`pill pill-${j.status}`}>{j.status}</span></td>
                <td className="hint">{j.tier || "—"}</td>
                <td className="hint">
                  {j.status === "failed"
                    ? j.error
                    : j.result?.emails?.length
                    ? `${j.result.emails.length} email(s): ${j.result.emails.join(", ")}`
                    : j.status === "done"
                    ? "No public email found"
                    : "—"}
                </td>
                <td className="hint">{new Date(j.createdAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
