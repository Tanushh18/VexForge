import { Router } from "express";
import PipelineRun from "../models/PipelineRun.js";
import Lead from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { listSources } from "../services/leadSources/index.js";
import { startPipelineRun, pipelineIsRunning, DEFAULTS } from "../services/pipelineService.js";
import { quotaStatus } from "../services/sendQuotaService.js";

const router = Router();
router.use(requireAuth);

router.get("/sources", (_req, res) => {
  res.json({ sources: listSources(), defaults: DEFAULTS });
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

// A snapshot of the whole funnel for the Pipeline page header: whether a run
// is going, what the CRM looks like by score band, and how much of today's
// send budget is left.
router.get("/status", async (_req, res) => {
  const [bands, latest, quota] = await Promise.all([
    Lead.aggregate([{ $group: { _id: "$scoreBand", count: { $sum: 1 } } }]),
    PipelineRun.findOne().sort({ createdAt: -1 }).lean(),
    quotaStatus(),
  ]);
  res.json({
    running: pipelineIsRunning(),
    bands: Object.fromEntries(bands.map((b) => [b._id || "cold", b.count])),
    latestRun: latest,
    quota,
  });
});

// Kicks off a run and returns immediately — the crawl takes minutes, so the
// page polls GET /runs/:id rather than holding the request open.
router.post("/run", async (req, res) => {
  try {
    const run = await startPipelineRun(req.body || {}, "manual");
    res.status(202).json(run);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

export default router;
