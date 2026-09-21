import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const POLL_MS = 3000;

export default function Admin() {
  const [jobs, setJobs] = useState([]);
  const [models, setModels] = useState(null);
  const [bgJobs, setBgJobs] = useState([]);
  const [worker, setWorker] = useState(null);
  const [form, setForm] = useState({ companyName: "", domain: "", industry: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ollamaUrlInput, setOllamaUrlInput] = useState("");
  const [ollamaSaved, setOllamaSaved] = useState("");
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState("");

  async function load() {
    setJobs(await api.scrapeJobs());
  }

  // Model and background-job state change on their own schedule, not with the
  // scan-job poll, so they load separately and refresh far less often.
  async function loadSystem() {
    const [m, j, p, s] = await Promise.all([
      api.models().catch(() => null),
      api.jobs().catch(() => []),
      api.pipelineStatus().catch(() => null),
      api.settings().catch(() => null),
    ]);
    setModels(m);
    setBgJobs(j);
    setWorker(p?.worker || null);
    if (s) {
      setOllamaSaved(s.ollamaUrl || "");
      setOllamaUrlInput((current) => (current ? current : s.ollamaUrl || ""));
    }
  }

  async function saveOllamaUrl(e) {
    e.preventDefault();
    setOllamaBusy(true);
    setOllamaError("");
    try {
      const res = await api.updateSettings({ ollamaUrl: ollamaUrlInput.trim() });
      setOllamaSaved(res.ollamaUrl || "");
      setModels(res.models);
    } catch (err) {
      setOllamaError(err.message);
    } finally {
      setOllamaBusy(false);
    }
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
            No local model backend reachable. Start Ollama (<code>ollama serve</code>) and pull the models
            listed in the README — the app still runs, but drafting, scoring and the chatbot stay off.
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Role</th><th>Model</th><th>Pulled</th><th>Actually used</th></tr></thead>
            <tbody>
              {(models.roles || []).map((r) => (
                <tr key={r.role}>
                  <td style={{ fontWeight: 600 }}>{r.role}</td>
                  <td className="hint">{r.model}</td>
                  <td><span className={`pill pill-${r.available ? "done" : "failed"}`}>{r.available ? "yes" : "no"}</span></td>
                  <td className="hint">{r.resolvesTo || "none available"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={saveOllamaUrl} style={{ marginTop: 14, borderTop: "1px solid var(--border, #2a2a2a)", paddingTop: 14 }}>
          <div className="field">
            <label>Ollama tunnel URL</label>
            <div className="hint" style={{ marginBottom: 6 }}>
              Deployed instances have no local Ollama. Point this at a tunnel to your own machine (e.g.{" "}
              <code>cloudflared tunnel --url http://localhost:11434</code>) instead of redeploying with a new
              env var. Leave blank to fall back to <code>OLLAMA_URL</code>.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ flex: 1 }}
                placeholder="https://your-tunnel.trycloudflare.com"
                value={ollamaUrlInput}
                onChange={(e) => setOllamaUrlInput(e.target.value)}
              />
              <button className="btn btn-sm" disabled={ollamaBusy}>
                {ollamaBusy ? "Saving…" : "Save"}
              </button>
            </div>
            {ollamaError && <div className="error-box" style={{ marginTop: 8 }}>{ollamaError}</div>}
            {ollamaSaved && !ollamaError && (
              <div className="hint" style={{ marginTop: 8 }}>Currently using: {ollamaSaved}</div>
            )}
          </div>
        </form>
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
