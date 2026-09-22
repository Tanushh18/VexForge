import { Router } from "express";
import PipelineRun from "../models/PipelineRun.js";
import ScrapeJob from "../models/ScrapeJob.js";
import Lead from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorker, workerAuthConfigured } from "../middleware/workerAuth.js";
import { quotaStatus } from "../services/sendQuotaService.js";
import { recordWorkerSeen, workerStatus } from "../services/workerRegistry.js";
import { ingestLeads } from "../services/leadIngestService.js";
import { notify } from "../services/notifyService.js";
import { logActivity } from "../models/ActivityLog.js";
import { SOURCE_CATALOGUE, DEFAULTS, enqueueRun, findActiveRun } from "../services/pipelineQueue.js";
import { githubTriggerStatus } from "../services/githubTrigger.js";

const router = Router();

// --- Worker-facing endpoints ------------------------------------------------
// Mounted before requireAuth: the worker has a key, not a JWT session.

// Long-ish poll target. The worker calls this on a loop; it also doubles as
// the heartbeat that drives the "worker online" badge in the UI.
router.post("/worker/poll", requireWorker, async (req, res) => {
  recordWorkerSeen(req.workerId, { version: req.body?.version, capabilities: req.body?.capabilities });

  // Oldest queued job first, claimed atomically so two workers on the same
  // key can't pick up the same one.
  //
  // Deep scans are checked first and are much shorter: a discovery run takes
  // minutes, so a scan queued behind one would otherwise sit there while you
  // stare at the Admin page waiting for it.
  const scan = await ScrapeJob.findOneAndUpdate(
    { status: "queued" },
    { status: "claimed", claimedBy: req.workerId, claimedAt: new Date() },
    { sort: { createdAt: 1 }, new: true }
  );
  if (scan) {
    return res.json({
      job: {
        kind: "deep_scan",
        id: scan._id,
        domain: scan.domain,
        companyName: scan.companyName,
        industry: scan.industry,
      },
    });
  }

  const run = await PipelineRun.findOneAndUpdate(
    { status: "queued" },
    { status: "claimed", claimedBy: req.workerId, claimedAt: new Date(), stage: "discover" },
    { sort: { createdAt: 1 }, new: true }
  );
  if (run) return res.json({ job: { kind: "discovery", id: run._id, options: run.options } });

  res.json({ job: null });
});

// A deep scan's result. The worker ran Chromium; the server owns dedupe and
// lead creation, same as for discovery.
router.post("/worker/scans/:id/finish", requireWorker, async (req, res) => {
  const { emails = [], pagesOk = [], pagesTried = [], tier, error } = req.body || {};
  const job = await ScrapeJob.findById(req.params.id);
  if (!job) return res.status(404).json({ error: "Scan job not found" });

  job.status = error ? "failed" : "done";
  job.error = error;
  job.tier = tier;
  job.result = { emails, pagesOk, pagesTried };
  job.finishedAt = new Date();

  if (!error && emails.length) {
    const ingest = await ingestLeads(
      [
        {
          companyName: job.companyName,
          industry: job.industry,
          website: job.domain,
          contactEmail: emails[0],
          sourceNote: `Deep scan (${tier}) — found on: ${pagesOk.join(", ")}`,
        },
      ],
      { workerId: req.workerId }
    );
    job.leadId = ingest.leadIds[0];
  }
  await job.save();

  await logActivity({
    actorName: "Trace",
    department: "Operations",
    action: error ? "Deep scan failed" : emails.length ? "Deep scan found contact" : "Deep scan found nothing",
    detail: `${job.companyName} (${job.domain})${error ? ` — ${error}` : ""}`,
  });

  res.json(job);
});

router.post("/worker/runs/:id/progress", requireWorker, async (req, res) => {
  const { stage, note, percent, stats, sourceResults } = req.body || {};
  const update = { status: "running", lastProgressAt: new Date() };
  if (stage) update.stage = stage;
  if (typeof note === "string") update.note = note.slice(0, 300);
  if (typeof percent === "number") update.percent = Math.max(0, Math.min(100, percent));
  if (stats) update.stats = stats;
  if (sourceResults) update.sourceResults = sourceResults;
  if (!(await PipelineRun.findById(req.params.id))) return res.status(404).json({ error: "Run not found" });

  const run = await PipelineRun.findByIdAndUpdate(req.params.id, update, { new: true });
  res.json(run);
});

// The worker submits leads as it goes rather than all at once, so a run that
// dies halfway still leaves you the companies it already found.
router.post("/worker/runs/:id/leads", requireWorker, async (req, res) => {
  const run = await PipelineRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });

  const result = await ingestLeads(req.body?.leads || [], { workerId: req.workerId });
  run.stats.created += result.created;
  run.stats.duplicates += result.duplicates;
  run.stats.drafted += result.drafted;
  run.stats.hot += result.hot;
  run.lastProgressAt = new Date();
  await run.save();

  res.json(result);
});

router.post("/worker/runs/:id/finish", requireWorker, async (req, res) => {
  const { status, error, summary, sourceResults, stats } = req.body || {};
  const run = await PipelineRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });

  run.status = status === "failed" ? "failed" : "done";
  run.stage = "done";
  run.percent = 100;
  run.error = error;
  run.summary = summary;
  if (sourceResults) run.sourceResults = sourceResults;
  if (stats) run.stats = { ...run.stats.toObject?.() ?? run.stats, ...stats };
  run.finishedAt = new Date();
  await run.save();

  await logActivity({
    actorName: "Pipeline",
    department: "Operations",
    action: run.status === "failed" ? "Lead pipeline run failed" : "Lead pipeline run finished",
    detail:
      run.status === "failed"
        ? error
        : `${run.stats.created} new · ${run.stats.enriched} enriched · ${run.stats.hot} hot · ${run.stats.drafted} drafted`,
    entityType: "PipelineRun",
    entityId: run._id,
  });
  if (run.status === "done" && run.stats.created) {
    await notify(
      `🎯 Pipeline run done — *${run.stats.created}* new leads (${run.stats.hot} hot), ${run.stats.drafted} draft(s) awaiting your approval.`
    );
  }

  res.json(run);
});

// --- Console-facing endpoints -----------------------------------------------
router.use(requireAuth);

router.get("/sources", (_req, res) => {
  res.json({ sources: SOURCE_CATALOGUE, defaults: DEFAULTS });
});

router.get("/runs", async (_req, res) => {
  const runs = await PipelineRun.find().sort({ createdAt: -1 }).limit(20).lean();
  res.json(runs);
});

router.get("/runs/:id", async (req, res) => {
  const run = await PipelineRun.findById(req.params.id).lean();
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(run);
});

// Everything the Pipeline page's header needs in one poll: whether a run is
// live and what stage it's at, whether a worker is actually connected, the
// CRM's shape by band, and today's remaining send budget.
router.get("/status", async (_req, res) => {
  const [bands, active, latest, quota] = await Promise.all([
    Lead.aggregate([{ $group: { _id: "$scoreBand", count: { $sum: 1 } } }]),
    findActiveRun().lean(),
    PipelineRun.findOne({ status: { $in: ["done", "failed"] } }).sort({ createdAt: -1 }).lean(),
    quotaStatus(),
  ]);
  res.json({
    running: !!active,
    activeRun: active,
    latestRun: latest,
    bands: Object.fromEntries(bands.map((b) => [b._id || "cold", b.count])),
    quota,
    worker: { ...workerStatus(), configured: workerAuthConfigured() },
    githubTrigger: githubTriggerStatus(),
  });
});

// Queues a run. The work happens on the local worker, so this only ever
// creates the ticket — if no worker is polling, the job sits in `queued` and
// the UI says so rather than pretending something is happening.
router.post("/run", async (req, res) => {
  try {
    const run = await enqueueRun(req.body || {}, "manual");
    res.status(202).json(run);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, runId: err.runId });
  }
});

export default router;
