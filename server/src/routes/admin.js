import { Router } from "express";
import ScrapeJob from "../models/ScrapeJob.js";
import Lead from "../models/Lead.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";

import { modelStatus, refreshModelHealth, complete } from "../../../shared/modelRouter.js";
import { jobStatus, runJobNow } from "../services/jobRegistry.js";
import { scoreLead } from "../../../shared/scoring.js";
import { getSettings } from "../models/Settings.js";

const router = Router();
router.use(requireAuth);

// Which Groq key/model each role is currently resolving to — the fastest way
// to tell "no keys configured" apart from "a key is rate-limited" when a
// draft fails.
router.get("/models", async (_req, res) => {
  await refreshModelHealth();
  res.json(modelStatus());
});

// Fires a real completion through the "fast" role so the Admin page can show
// actual model output, not just "a key is configured" — a key can be present
// and still fail (wrong value, rate-limited, model renamed on Groq's end),
// and the status panel alone can't tell those apart from a working setup.
router.post("/models/test", async (_req, res) => {
  const started = Date.now();
  try {
    const text = await complete("fast", {
      system: "Reply with a short, friendly one-sentence confirmation that you're working.",
      prompt: "Are you working?",
      timeoutMs: 20000,
    });
    res.json({ ok: true, text, model: modelStatus().roles.find((r) => r.role === "fast")?.model, ms: Date.now() - started });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, ms: Date.now() - started });
  }
});

// Runtime settings that shouldn't need a redeploy to change (just the
// rotation cursor today — the Groq keys live in env vars, not here, since
// they're secrets rather than a tunnel URL).
router.get("/settings", async (_req, res) => {
  res.json(await getSettings());
});

router.get("/jobs", (_req, res) => {
  res.json(jobStatus());
});

router.post("/jobs/:key/run", async (req, res) => {
  try {
    res.json(await runJobNow(req.params.key));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/scrape-jobs", async (_req, res) => {
  const jobs = await ScrapeJob.find().sort({ createdAt: -1 }).limit(30).lean();
  res.json(jobs);
});

router.get("/scrape-jobs/:id", async (req, res) => {
  const job = await ScrapeJob.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
});

// Queues a Playwright deep scan for the local worker to pick up. Chromium
// runs on the worker's machine, not here, so this only ever creates the
// ticket — the Admin page polls GET /scrape-jobs/:id for the result, exactly
// as it did when the scan ran in-process.
router.post("/scrape-jobs", async (req, res) => {
  const { domain, companyName, industry } = req.body || {};
  if (!domain || !companyName) return res.status(400).json({ error: "domain and companyName are required" });

  const job = await ScrapeJob.create({ domain, companyName, industry, status: "queued" });
  const agent = await Employee.findOne({ title: /Enrichment Agent/i });
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Queued a deep scan of ${domain}` });
  await logActivity({
    actor: agent?._id,
    actorName: agent?.name || "Trace",
    department: "Operations",
    action: "Deep scan queued",
    detail: `${companyName} (${domain})`,
  });

  res.status(201).json(job);
});

export default router;
