import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const TABS = ["draft", "approved", "sent", "rejected"];

export default function Outreach() {
  const [items, setItems] = useState([]);
  const [leads, setLeads] = useState([]);
  const [tab, setTab] = useState("draft");
  const [genLead, setGenLead] = useState("");
  const [genChannel, setGenChannel] = useState("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emailConfigured, setEmailConfigured] = useState(false);

  async function load() {
    const [msgs, leadList, cfg] = await Promise.all([api.outreach({ status: tab }), api.leads(), api.outreachConfig()]);
    setItems(msgs);
    setLeads(leadList);
    setEmailConfigured(cfg.emailConfigured);
  }
  useEffect(() => { load(); }, [tab]);

  async function generate() {
    if (!genLead) return;
    setBusy(true);
    setError("");
    try {
      await api.generateOutreach({ leadId: genLead, channel: genChannel });
      setTab("draft");
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function act(fn, id) {
    setBusy(true);
    try { await fn(id); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Outreach Queue</div>
        <div className="page-sub">
          Every message is AI-drafted, then sits here until you approve it. Email can send automatically once
          SMTP is configured; LinkedIn never auto-sends — approving just gives you a ready-to-paste message and
          a direct search link.
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="row">
          <div className="field">
            <label>Lead</label>
            <select value={genLead} onChange={(e) => setGenLead(e.target.value)}>
              <option value="">Select a lead…</option>
              {leads.map((l) => <option key={l._id} value={l._id}>{l.companyName}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Channel</label>
            <select value={genChannel} onChange={(e) => setGenChannel(e.target.value)}>
              <option value="email">Email</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </div>
        </div>
        <button className="btn btn-molten" disabled={!genLead || busy} onClick={generate}>
          {busy ? "Drafting…" : "Generate draft with Ember"}
        </button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">Nothing in "{tab}" right now.</div>
      ) : (
        <div className="grid grid-2">
          {items.map((m) => (
            <div className="card" key={m._id}>
              <div className="toolbar" style={{ marginBottom: 10 }}>
                <div>
                  <strong>{m.lead?.companyName || "Unknown company"}</strong>
                  <div className="hint">{m.channel} · {m.lead?.contactEmail || "no email on file"}</div>
                </div>
                <span className={`pill pill-${m.status}`}>{m.status}</span>
              </div>
              {m.subject && <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13.5 }}>{m.subject}</div>}
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, color: "var(--fog)", marginBottom: 14 }}>{m.body}</div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {m.status === "draft" && (
                  <>
                    <button className="btn btn-molten btn-sm" disabled={busy} onClick={() => act(api.approveOutreach, m._id)}>Approve</button>
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(api.rejectOutreach, m._id)}>Reject</button>
                  </>
                )}
                {m.status === "approved" && m.channel === "email" && emailConfigured && (
                  <button className="btn btn-molten btn-sm" disabled={busy} onClick={() => act(api.sendOutreachEmail, m._id)}>Send email now</button>
                )}
                {m.status === "approved" && (m.channel === "linkedin" || !emailConfigured) && (
                  <>
                    {m.channel === "linkedin" && (
                      <a className="btn btn-ghost btn-sm" target="_blank" rel="noopener"
                         href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(m.lead?.companyName || "")}`}>
                        Open LinkedIn search →
                      </a>
                    )}
                    {m.channel === "email" && m.lead?.contactEmail && (
                      <a className="btn btn-ghost btn-sm" href={`mailto:${m.lead.contactEmail}?subject=${encodeURIComponent(m.subject || "")}&body=${encodeURIComponent(m.body)}`}>
                        Open in email client →
                      </a>
                    )}
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(api.markOutreachSent, m._id)}>I sent it — mark sent</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
