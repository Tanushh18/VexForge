import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const STAGES = ["new", "reviewed", "outreach_drafted", "outreach_sent", "responded", "call_booked", "won", "lost"];

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showScrape, setShowScrape] = useState(false);
  const [form, setForm] = useState({ companyName: "", website: "", industry: "", contactEmail: "", contactName: "", notes: "" });
  const [scrapeForm, setScrapeForm] = useState({ companyName: "", domain: "", industry: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLeads(await api.leads());
  }
  useEffect(() => { load(); }, []);

  async function addLead(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createLead(form);
      setForm({ companyName: "", website: "", industry: "", contactEmail: "", contactName: "", notes: "" });
      setShowAdd(false);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function scrape(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.scrapeLead(scrapeForm);
      setScrapeForm({ companyName: "", domain: "", industry: "" });
      setShowScrape(false);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function setStage(id, stage) {
    await api.updateLead(id, { stage });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">CRM · Pipeline</div>
        <div className="page-sub">Every prospect — added manually or by the Lead Scout agent's public-website contact lookup.</div>
      </div>

      <div className="toolbar">
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-molten" onClick={() => { setShowAdd((s) => !s); setShowScrape(false); }}>+ Add lead</button>
          <button className="btn btn-ghost" onClick={() => { setShowScrape((s) => !s); setShowAdd(false); }}>Find contact via website scan</button>
        </div>
        <div className="hint">{leads.length} leads total</div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      {showAdd && (
        <form className="panel" onSubmit={addLead} style={{ marginBottom: 18 }}>
          <div className="row">
            <div className="field"><label>Company name *</label><input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></div>
            <div className="field"><label>Website</label><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>Industry</label><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
            <div className="field"><label>Contact name</label><input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
            <div className="field"><label>Contact email</label><input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
          </div>
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <button className="btn btn-molten" disabled={busy}>{busy ? "Saving…" : "Save lead"}</button>
        </form>
      )}

      {showScrape && (
        <form className="panel" onSubmit={scrape} style={{ marginBottom: 18 }}>
          <p className="hint" style={{ marginBottom: 12 }}>
            Scans the company's own homepage/contact/about pages for a publicly-listed email. No login, no
            LinkedIn, no third-party directories — just what they've published themselves.
          </p>
          <div className="row">
            <div className="field"><label>Company name *</label><input required value={scrapeForm.companyName} onChange={(e) => setScrapeForm({ ...scrapeForm, companyName: e.target.value })} /></div>
            <div className="field"><label>Domain *</label><input required placeholder="example.com" value={scrapeForm.domain} onChange={(e) => setScrapeForm({ ...scrapeForm, domain: e.target.value })} /></div>
            <div className="field"><label>Industry</label><input value={scrapeForm.industry} onChange={(e) => setScrapeForm({ ...scrapeForm, industry: e.target.value })} /></div>
          </div>
          <button className="btn btn-molten" disabled={busy}>{busy ? "Scanning…" : "Scan & add lead"}</button>
        </form>
      )}

      {leads.length === 0 ? (
        <div className="empty">No leads yet — add one manually or run a website scan.</div>
      ) : (
        <table className="table">
          <thead><tr><th>Company</th><th>Contact</th><th>Source</th><th>Stage</th><th></th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l._id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.companyName}</div>
                  <div className="hint">{l.website}</div>
                </td>
                <td>
                  <div>{l.contactName || "—"}</div>
                  <div className="hint">{l.contactEmail || "no email on file"}</div>
                </td>
                <td><span className="pill pill-default">{l.source}</span></td>
                <td>
                  <select value={l.stage} onChange={(e) => setStage(l._id, e.target.value)} className="pill pill-default" style={{ border: "1px solid var(--line)", background: "var(--iron-2)" }}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => api.deleteLead(l._id).then(load)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
