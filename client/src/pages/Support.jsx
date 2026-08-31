import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const STATUSES = ["open", "in_progress", "resolved", "escalated"];

export default function Support() {
  const [tickets, setTickets] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ contactName: "", contactPhone: "", contactEmail: "", company: "", channel: "call", reason: "feedback", transcript: "" });
  const [busy, setBusy] = useState(false);

  async function load() { setTickets(await api.tickets()); }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createTicket(form);
      setForm({ contactName: "", contactPhone: "", contactEmail: "", company: "", channel: "call", reason: "feedback", transcript: "" });
      setShowNew(false);
      await load();
    } finally { setBusy(false); }
  }

  async function update(id, patch) {
    await api.updateTicket(id, patch);
    load();
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Call & Feedback Support</div>
        <div className="page-sub">
          Live telephony isn't wired up (needs your own Twilio number + credentials — see README). Log every
          call/feedback conversation here: paste the transcript, note the resolution, keep the record.
        </div>
      </div>

      <div className="toolbar">
        <button className="btn btn-molten" onClick={() => setShowNew((s) => !s)}>+ Log a call / conversation</button>
        <div className="hint">{tickets.filter((t) => t.status === "open" || t.status === "in_progress").length} open</div>
      </div>

      {showNew && (
        <form className="panel" onSubmit={create} style={{ marginBottom: 18 }}>
          <div className="row">
            <div className="field"><label>Contact name *</label><input required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
            <div className="field"><label>Company</label><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>Phone</label><input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
            <div className="field"><label>Email</label><input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field">
              <label>Channel</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="chat">Chat</option>
              </select>
            </div>
            <div className="field">
              <label>Reason</label>
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                <option value="feedback">Feedback</option><option value="support">Support</option><option value="sales">Sales</option><option value="complaint">Complaint</option>
              </select>
            </div>
          </div>
          <div className="field"><label>Transcript / notes</label><textarea value={form.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })} placeholder="Paste the call transcript or type notes…" /></div>
          <button className="btn btn-molten" disabled={busy}>{busy ? "Saving…" : "Save ticket"}</button>
        </form>
      )}

      {tickets.length === 0 ? (
        <div className="empty">No tickets logged yet.</div>
      ) : (
        <table className="table">
          <thead><tr><th>Contact</th><th>Reason</th><th>Channel</th><th>Status</th></tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t._id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.contactName}</div>
                  <div className="hint">{t.company}</div>
                </td>
                <td><span className="pill pill-default">{t.reason}</span></td>
                <td>{t.channel}</td>
                <td>
                  <select value={t.status} onChange={(e) => update(t._id, { status: e.target.value })} className="pill pill-default" style={{ border: "1px solid var(--line)", background: "var(--iron-2)" }}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
