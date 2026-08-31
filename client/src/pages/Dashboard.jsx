import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api.js";
import OrgNode from "../components/OrgChart/OrgNode.jsx";

const POLL_MS = 6000; // re-fetch so "working" pulses reflect real, current activity

export default function Dashboard() {
  const [tree, setTree] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [orgRes, leads, outreach, tickets] = await Promise.all([
        api.orgTree(),
        api.leads(),
        api.outreach(),
        api.tickets(),
      ]);
      setTree(orgRes.root);
      setStats({
        headcount: countTree(orgRes.root),
        working: countWorking(orgRes.root),
        leads: leads.length,
        outreachAwaiting: outreach.filter((o) => o.status === "draft").length,
        openTickets: tickets.filter((t) => t.status === "open" || t.status === "in_progress").length,
      });
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <div className="empty">{error}</div>;
  if (!tree) return <div className="empty">Loading the org chart…</div>;

  const head = tree.reports?.[0];
  const managers = head?.reports || [];

  return (
    <div>
      <div className="page-head">
        <div className="page-title">Company Dashboard</div>
        <div className="page-sub">Live view of every department — status pulses when an agent is actively working.</div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 26 }}>
        <div className="card stat"><div className="n">{stats.headcount}</div><div className="l">Total headcount</div></div>
        <div className="card stat"><div className="n">{stats.working}</div><div className="l">Working right now</div></div>
        <div className="card stat"><div className="n">{stats.leads}</div><div className="l">Leads in pipeline</div></div>
        <div className="card stat"><div className="n">{stats.outreachAwaiting}</div><div className="l">Outreach awaiting your approval</div></div>
      </div>

      <div className="org-tree">
        <OrgNode person={tree} />
        {head && (
          <>
            <div style={{ width: 1, height: 20, background: "var(--line)" }} />
            <OrgNode person={head} />
          </>
        )}
      </div>

      <div className="dept-groups">
        {managers.map((mgr) => (
          <div className="dept-group" key={mgr._id}>
            <h4>{mgr.department}</h4>
            <OrgNode person={mgr} />
            {mgr.reports.map((agent) => (
              <OrgNode person={agent} key={agent._id} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function countTree(node) {
  if (!node) return 0;
  return 1 + (node.reports || []).reduce((sum, r) => sum + countTree(r), 0);
}
function countWorking(node) {
  if (!node) return 0;
  const self = node.status === "working" || node.status === "on_call" ? 1 : 0;
  return self + (node.reports || []).reduce((sum, r) => sum + countWorking(r), 0);
}
