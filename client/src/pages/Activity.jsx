import { useEffect, useState } from "react";
import { api } from "../services/api.js";

export default function Activity() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    async function load() { setItems(await api.activity(100)); }
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Activity Log</div>
        <div className="page-sub">Every recorded action across the company — the audit trail.</div>
      </div>
      {items.length === 0 ? (
        <div className="empty">Nothing logged yet.</div>
      ) : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Dept</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a._id}>
                <td className="hint">{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.actorName}</td>
                <td><span className="pill pill-default">{a.department || "—"}</span></td>
                <td>{a.action}</td>
                <td className="hint">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
