import { Router } from "express";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import Employee from "../models/Employee.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Ticket from "../models/Ticket.js";
import ActivityLog from "../models/ActivityLog.js";
import PipelineRun from "../models/PipelineRun.js";
import OfficeState from "../models/OfficeState.js";
import { requireAuth } from "../middleware/auth.js";
import { modelStatus } from "../../../shared/modelRouter.js";
import { jobStatus } from "../services/jobRegistry.js";
import { workerStatus } from "../services/workerRegistry.js";
import { quotaStatus, DAILY_SEND_CAP } from "../services/sendQuotaService.js";
import { emailIsConfigured } from "../services/emailService.js";
import { findActiveRun, SOURCE_CATALOGUE } from "../services/pipelineQueue.js";

const router = Router();
router.use(requireAuth);

// GET /api/company/pulse — one consolidated snapshot of the whole company.
//
// Every department gets the same shape: a list of live `checks` (each ok /
// warn / down, with a real value behind it) and a few headline `metrics`.
// Incidents are derived from failing checks and carry the team that owns
// them, so the Live Office can make the right team visibly react instead of
// miming generic work.

const SITE_CACHE_MS = 60000;
let siteCache = { at: 0, sites: [] };

function siteTargets() {
  const fromOrigins = (process.env.CLIENT_ORIGIN || "").split(",");
  const explicit = (process.env.SITE_HEALTH_URLS || "").split(",");
  return [...new Set([...explicit, ...fromOrigins].map((s) => s.trim()))]
    .filter((u) => /^https?:\/\//.test(u) && !/localhost|127\.0\.0\.1/.test(u))
    .map((url) => ({ name: url.replace(/^https?:\/\//, "").replace(/\/$/, ""), url }));
}

async function checkSites() {
  if (Date.now() - siteCache.at < SITE_CACHE_MS) return siteCache.sites;
  const sites = await Promise.all(
    siteTargets().map(async (s) => {
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(s.url, { signal: ctrl.signal, redirect: "follow" });
        return { ...s, ok: res.ok, status: res.status, ms: Date.now() - started };
      } catch (err) {
        return { ...s, ok: false, status: 0, ms: Date.now() - started, error: err.name === "AbortError" ? "timeout" : err.message };
      } finally {
        clearTimeout(timer);
      }
    })
  );
  siteCache = { at: Date.now(), sites };
  return sites;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const hoursSince = (d) => (d ? (Date.now() - new Date(d).getTime()) / 3600000 : null);
// A check is the unit every team's board is built from.
const check = (key, label, state, value, detail, action) => ({ key, label, state, value, detail, action });

export async function buildPulse() {
  const today = startOfToday();
  const dayAgo = new Date(Date.now() - 86400000);
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const [
    leadDocs, employees, drafts, approvedCount, sentToday, sentWeek, rejectedToday, failedToday, draftedToday,
    lastDraft, tickets, lastRun, activeRun, sites, quota,
  ] = await Promise.all([
    Lead.find({}, { stage: 1, contactEmail: 1, score: 1, scoreBand: 1, scoredAt: 1, source: 1, createdAt: 1 }).lean(),
    Employee.find({}, { name: 1, department: 1, status: 1, currentTask: 1, tasksCompleted: 1, lastActive: 1, level: 1 }).lean(),
    OutreachMessage.countDocuments({ status: "draft" }),
    OutreachMessage.countDocuments({ status: "approved" }),
    OutreachMessage.countDocuments({ status: "sent", sentAt: { $gte: today } }),
    OutreachMessage.countDocuments({ status: "sent", sentAt: { $gte: weekAgo } }),
    OutreachMessage.countDocuments({ status: "rejected", updatedAt: { $gte: today } }),
    ActivityLog.countDocuments({ action: /send failed/i, createdAt: { $gte: today } }),
    ActivityLog.countDocuments({ action: /draft generated/i, createdAt: { $gte: today } }),
    OutreachMessage.findOne({}).sort({ createdAt: -1 }).lean(),
    Ticket.find({}, { status: 1, urgency: 1, createdAt: 1, updatedAt: 1, contactName: 1, reason: 1 }).lean(),
    PipelineRun.findOne().sort({ createdAt: -1 }).lean(),
    findActiveRun(),
    checkSites(),
    quotaStatus(),
  ]);

  const models = modelStatus();
  const jobs = jobStatus();
  const worker = workerStatus();
  const mongoOk = mongoose.connection.readyState === 1;
  const keyCount = models.keyCount || 0;

  // ---- shared roll-ups ----
  const byStage = {};
  let noEmail = 0, hot = 0, unscored = 0, newThisWeek = 0;
  for (const l of leadDocs) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1;
    if (!l.contactEmail) noEmail += 1;
    if (l.scoreBand === "hot") hot += 1;
    if (!l.scoredAt) unscored += 1;
    if (new Date(l.createdAt) >= weekAgo) newThisWeek += 1;
  }
  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "in_progress");
  const escalated = tickets.filter((t) => t.status === "escalated");
  const staleTickets = openTickets.filter((t) => new Date(t.createdAt) < dayAgo);
  const resolvedToday = tickets.filter((t) => t.status === "resolved" && new Date(t.updatedAt) >= today);
  const role = (name) => (models.roles || []).find((r) => r.role === name) || {};
  const runAge = hoursSince(lastRun?.createdAt);

  const teams = {};

  // ---- Operations: the lead engine ----
  teams.ops = {
    label: "Operations — lead engine",
    metrics: [
      { label: "Leads", value: leadDocs.length }, { label: "Hot", value: hot },
      { label: "New this week", value: newThisWeek }, { label: "Unreviewed", value: byStage.new || 0 },
    ],
    checks: [
      check("ops.worker", "Discovery worker", worker.anyOnline ? "ok" : activeRun ? "down" : "warn", worker.anyOnline ? "online" : "offline", worker.anyOnline ? `${worker.workers.length} worker(s) checked in` : "No worker has polled recently — discovery can't run", "pipeline"),
      check("ops.run", "Last pipeline run", !lastRun ? "warn" : lastRun.status === "failed" ? "down" : runAge > 48 ? "warn" : "ok", lastRun ? `${lastRun.status}${runAge != null ? ` · ${runAge.toFixed(0)}h ago` : ""}` : "never", lastRun?.error || `${lastRun?.counts?.discovered ?? 0} discovered, ${lastRun?.counts?.inserted ?? 0} new`, "pipeline"),
      check("ops.backlog", "Unreviewed backlog", (byStage.new || 0) >= 25 ? "warn" : "ok", byStage.new || 0, "Leads sitting in the 'new' stage", "leads"),
      check("ops.enrich", "Contact enrichment", noEmail >= 15 ? "warn" : "ok", `${noEmail} without email`, "Leads that can't be emailed until enriched", "admin"),
      check("ops.scoring", "Lead scoring", unscored > 5 ? "warn" : "ok", `${unscored} unscored`, "Leads waiting for a fit score", "leads"),
      check("ops.sources", "Discovery sources", "ok", `${SOURCE_CATALOGUE.length} configured`, "Sources available to the rotation", "pipeline"),
    ],
  };

  // ---- Product: the messaging engine ----
  const draftAge = hoursSince(lastDraft?.createdAt);
  teams.product = {
    label: "Product — messaging & drafts",
    metrics: [
      { label: "Awaiting approval", value: drafts }, { label: "Drafted today", value: draftedToday },
      { label: "Sent today", value: sentToday }, { label: "Sent this week", value: sentWeek },
    ],
    checks: [
      check("product.model", "Drafting model", !role("drafting").available ? "down" : "ok", role("drafting").model || "none", role("drafting").available ? `Role resolves to ${role("drafting").model}` : "No API key available for drafting", "admin"),
      check("product.queue", "Approval queue", drafts >= 5 ? "warn" : "ok", drafts, "Drafts waiting on the CEO's desk", "outreach"),
      check("product.failed", "Send failures today", failedToday > 0 ? "down" : "ok", failedToday, failedToday ? "Emails failed to leave the building" : "No failures", "outreach"),
      check("product.rejected", "Rejected today", rejectedToday >= 3 ? "warn" : "ok", rejectedToday, "Drafts you rejected — tone may need work", "outreach"),
      check("product.fresh", "Draft freshness", draftAge == null || draftAge > 48 ? "warn" : "ok", draftAge == null ? "none yet" : `${draftAge.toFixed(0)}h ago`, "Time since the last draft was written", "outreach"),
      check("product.approved", "Approved, not sent", approvedCount > 0 ? "warn" : "ok", approvedCount, "Approved drafts still waiting to go out", "outreach"),
    ],
  };

  // ---- Tech: infrastructure ----
  const techChecks = [
    check("tech.db", "MongoDB", mongoOk ? "ok" : "down", mongoOk ? "connected" : "disconnected", "Primary datastore", "admin"),
    check("tech.keys", "Model API keys", keyCount === 0 ? "down" : keyCount === 1 ? "warn" : "ok", `${keyCount} key(s)`, keyCount ? `Backend: ${models.backend} · active key #${(models.activeKeyIndex ?? 0) + 1}` : "GROQ_API_KEYS is empty — drafting and scoring will fail", "admin"),
    check("tech.smtp", "SMTP (outbound email)", emailIsConfigured() ? "ok" : "down", emailIsConfigured() ? "configured" : "missing", "Required to send approved drafts", "admin"),
    check("tech.imap", "IMAP (reply detection)", process.env.IMAP_HOST ? "ok" : "warn", process.env.IMAP_HOST ? "configured" : "off", "Detects replies from leads", "admin"),
    check("tech.worker", "Local worker", worker.anyOnline ? "ok" : "warn", worker.anyOnline ? "online" : "offline", "Runs Playwright discovery and deep scans", "pipeline"),
    check("tech.gh", "GitHub Actions trigger", process.env.GITHUB_TRIGGER_TOKEN ? "ok" : "warn", process.env.GITHUB_TRIGGER_TOKEN ? "configured" : "off", "Wakes the workflow when a run is queued", "admin"),
    check("tech.telegram", "Telegram alerts", process.env.TELEGRAM_BOT_TOKEN ? "ok" : "warn", process.env.TELEGRAM_BOT_TOKEN ? "configured" : "off", "Push notifications for new drafts and replies", "admin"),
  ];
  for (const r of models.roles || []) {
    techChecks.push(check(`tech.model.${r.role}`, `Model · ${r.role}`, r.available ? "ok" : "down", r.model || "unresolved", r.available ? "Serving requests" : "No healthy API key", "admin"));
  }
  for (const j of jobs) {
    techChecks.push(check(`tech.job.${j.key}`, `Job · ${j.label}`, !j.enabled ? "off" : j.lastOk === false ? "down" : "ok", !j.enabled ? "disabled" : j.lastRunAt ? `ran ${hoursSince(j.lastRunAt).toFixed(1)}h ago` : "not yet run", j.lastError || `every ${Math.round(j.everyMs / 60000)} min`, "admin"));
  }
  for (const s of sites) {
    techChecks.push(check(`tech.site.${s.url}`, `Site · ${s.name}`, s.ok ? (s.ms > 4000 ? "warn" : "ok") : "down", s.ok ? `${s.ms}ms` : s.error || `HTTP ${s.status}`, s.url, "admin"));
  }
  teams.tech = {
    label: "Tech — infrastructure & models",
    metrics: [
      { label: "Sites up", value: `${sites.filter((s) => s.ok).length}/${sites.length}` },
      { label: "Jobs healthy", value: `${jobs.filter((j) => j.lastOk !== false).length}/${jobs.length}` },
      { label: "Model keys", value: keyCount },
      { label: "Worker", value: worker.anyOnline ? "online" : "offline" },
    ],
    checks: techChecks,
  };

  // ---- HR: the people side ----
  const byDept = {};
  for (const e of employees) {
    const d = (byDept[e.department] ||= { total: 0, working: 0, idle: 0, done: 0 });
    d.total += 1;
    if (e.status === "working" || e.status === "on_call") d.working += 1; else d.idle += 1;
    d.done += e.tasksCompleted || 0;
  }
  const staleAgents = employees.filter((e) => e.level !== "ceo" && hoursSince(e.lastActive) > 72);
  teams.hr = {
    label: "HR — people & capacity",
    metrics: [
      { label: "Headcount", value: employees.length },
      { label: "Working now", value: employees.filter((e) => e.status === "working" || e.status === "on_call").length },
      { label: "Tasks completed", value: employees.reduce((s, e) => s + (e.tasksCompleted || 0), 0) },
      { label: "Departments", value: Object.keys(byDept).length },
    ],
    checks: [
      check("hr.roster", "Roster synced", employees.length > 0 ? "ok" : "down", `${employees.length} on the books`, "Employee records seeded from the org chart", "hr"),
      check("hr.idle", "Idle agents", employees.filter((e) => e.status === "idle").length > employees.length * 0.8 ? "warn" : "ok", employees.filter((e) => e.status === "idle").length, "Agents with no current task", "hr"),
      check("hr.stale", "Inactive over 72h", staleAgents.length ? "warn" : "ok", staleAgents.length, staleAgents.map((e) => e.name).join(", ") || "Everyone active recently", "hr"),
      check("hr.load", "Workload balance", "ok", `${Object.entries(byDept).map(([d, v]) => `${d}:${v.working}/${v.total}`).join("  ")}`, "Working vs total per department", "hr"),
    ],
    byDept,
  };

  // ---- Finance: money & quota ----
  const pipelineValue = hot * 2500 + (byStage.call_booked || 0) * 8000 + (byStage.won || 0) * 15000;
  teams.fin = {
    label: "Finance — quota, cost & pipeline value",
    metrics: [
      { label: "Send quota left", value: `${quota.remaining}/${quota.cap}` },
      { label: "Sent today", value: sentToday },
      { label: "Pipeline value", value: `₹${(pipelineValue / 1000).toFixed(0)}k` },
      { label: "Won", value: byStage.won || 0 },
    ],
    checks: [
      check("fin.quota", "Daily send cap", quota.remaining === 0 ? "down" : quota.remaining <= 3 ? "warn" : "ok", `${quota.used}/${quota.cap} used`, `Resets ${new Date(quota.resetsAt).toLocaleTimeString()}`, "outreach"),
      check("fin.burn", "Send pace", sentToday > DAILY_SEND_CAP * 0.8 ? "warn" : "ok", `${sentToday} today · ${sentWeek} this week`, "Deliverability guard — ramp slowly", "outreach"),
      check("fin.value", "Pipeline value", "ok", `₹${(pipelineValue / 1000).toFixed(0)}k`, `${hot} hot · ${byStage.call_booked || 0} calls booked · ${byStage.won || 0} won`, "leads"),
      check("fin.models", "Model spend risk", keyCount <= 1 ? "warn" : "ok", `${keyCount} key(s)`, "Free-tier headroom depends on key count", "admin"),
      check("fin.conversion", "Reply conversion", (byStage.responded || 0) === 0 && sentWeek > 5 ? "warn" : "ok", `${byStage.responded || 0} replies / ${sentWeek} sent`, "Replies against emails sent this week", "leads"),
    ],
  };

  // ---- Support: service quality ----
  const oldest = openTickets.map((t) => hoursSince(t.createdAt)).sort((a, b) => b - a)[0];
  teams.sup = {
    label: "Support — tickets & SLA",
    metrics: [
      { label: "Open", value: openTickets.length }, { label: "Escalated", value: escalated.length },
      { label: "Resolved today", value: resolvedToday.length }, { label: "Oldest open", value: oldest ? `${oldest.toFixed(0)}h` : "—" },
    ],
    checks: [
      check("sup.open", "Open tickets", openTickets.length >= 3 ? "warn" : "ok", openTickets.length, "Tickets in open or in-progress", "support"),
      check("sup.escalated", "Escalations", escalated.length ? "down" : "ok", escalated.length, escalated.length ? "Escalated tickets need an answer today" : "None", "support"),
      check("sup.sla", "24h SLA breaches", staleTickets.length ? "warn" : "ok", staleTickets.length, "Open tickets older than a day", "support"),
      check("sup.urgent", "High urgency", openTickets.filter((t) => t.urgency === "high").length ? "warn" : "ok", openTickets.filter((t) => t.urgency === "high").length, "Open tickets marked high urgency", "support"),
      check("sup.transcribe", "Call transcription", process.env.TRANSCRIBE_API_KEY ? "ok" : "warn", process.env.TRANSCRIBE_API_KEY ? "configured" : "off", "Audio uploads are transcribed automatically", "support"),
    ],
  };

  // Incidents = every failing check, owned by its team.
  const incidents = [];
  for (const [team, t] of Object.entries(teams)) {
    for (const c of t.checks) {
      if (c.state === "down" || c.state === "warn") {
        incidents.push({ key: c.key, team, severity: c.state === "down" ? "critical" : "warn", title: `${c.label}: ${c.value}`, detail: c.detail, action: c.action });
      }
    }
  }

  return {
    at: new Date(),
    teams,
    incidents,
    models, jobs, worker, sites,
    emailConfigured: emailIsConfigured(),
    quota,
    leads: { total: leadDocs.length, byStage, noEmail, hot, unscored, newThisWeek },
    outreach: { drafts, approved: approvedCount, sentToday, sentWeek, failedToday, draftedToday, rejectedToday },
    tickets: { open: openTickets.length, escalated: escalated.length, resolvedToday: resolvedToday.length },
    pipeline: { lastRun, activeRun },
    employees,
  };
}

router.get("/pulse", async (_req, res) => {
  res.json(await buildPulse());
});

// The Live Office's saved day. The client writes a compact snapshot every
// few seconds and reads it back on load, so the clock, attendance, morale
// and staffing survive a refresh instead of restarting at 09:20.
router.get("/office-state", async (_req, res) => {
  const doc = await OfficeState.findOne({ key: "office" }).lean();
  res.json(doc?.data || null);
});

router.put("/office-state", async (req, res) => {
  const data = req.body || {};
  await OfficeState.findOneAndUpdate({ key: "office" }, { data }, { upsert: true, new: true });
  res.json({ ok: true, savedAt: new Date() });
});

export default router;
