import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const POLL_MS = 3000;

export default function Admin() {
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState({ companyName: "", domain: "", industry: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setJobs(await api.scrapeJobs());
  }

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
        <div className="page-title">Admin · Deep Scan</div>
        <div className="page-sub">
          Playwright-driven contact lookup for JS-rendered sites the fast scanner on the CRM page can't see.
          Tries the cheap static scan first — a real headless browser only runs if that comes back empty.
          Runs as a background job; refresh here to watch it finish.
        </div>
      </div>

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
