import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api.js";
import OrgNode from "../components/OrgChart/OrgNode.jsx";

const POLL_MS = 6000; // re-fetch so "working" pulses reflect real, current activity

const FUNNEL_STAGES = ["new", "reviewed", "outreach_drafted", "outreach_sent", "responded", "call_booked", "won"];
const STAGE_LABELS = {
  new: "New",
  reviewed: "Reviewed",
  outreach_drafted: "Drafted",
  outreach_sent: "Sent",
  responded: "Responded",
  call_booked: "Call booked",
  won: "Won",
};

function LeadFunnel({ leads }) {
  const counts = FUNNEL_STAGES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  let lost = 0;
  for (const l of leads) {
    if (l.stage === "lost") lost += 1;
    else if (counts[l.stage] !== undefined) counts[l.stage] += 1;
  }
  const max = Math.max(1, ...FUNNEL_STAGES.map((s) => counts[s]));

  return (
    <div className="card" style={{ marginBottom: 26 }}>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <strong>Pipeline funnel</strong>
        {lost > 0 && <span className="pill pill-lost">{lost} lost</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {FUNNEL_STAGES.map((s) => (
          <div key={s} style={{ display: "grid", gridTemplateColumns: "100px 1fr 26px", alignItems: "center", gap: 10 }}>
            <span className="hint">{STAGE_LABELS[s]}</span>
            <div style={{ background: "var(--steel-2)", borderRadius: 6, height: 10, overflow: "hidden" }}>
              <div
                style={{
                  width: counts[s] ? `${Math.max((counts[s] / max) * 100, 4)}%` : 0,
                  height: "100%",
                  background: "var(--molten)",
                  borderRadius: 6,
                }}
              />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>{counts[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DigestCard({ digest }) {
  if (!digest) return null;
  return (
    <div className="card" style={{ marginBottom: 26 }}>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <strong>Weekly digest</strong>
        <span className="hint">
          {new Date(digest.periodStart).toLocaleDateString()} – {new Date(digest.periodEnd).toLocaleDateString()}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--fog)", whiteSpace: "pre-wrap" }}>{digest.text}</div>
    </div>
  );
}

export default function Dashboard() {
  const [tree, setTree] = useState(null);
  const [stats, setStats] = useState(null);
  const [leads, setLeads] = useState([]);
  const [digest, setDigest] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [orgRes, leadList, outreach, tickets] = await Promise.all([
        api.orgTree(),
        api.leads(),
        api.outreach(),
        api.tickets(),
      ]);
      setTree(orgRes.root);
      setLeads(leadList);
      setStats({
        headcount: countTree(orgRes.root),
        working: countWorking(orgRes.root),
        leads: leadList.length,
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

  useEffect(() => {
    api.digestLatest().then(setDigest).catch(() => {});
  }, []);

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

      {leads.length > 0 && <LeadFunnel leads={leads} />}
      <DigestCard digest={digest} />

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
