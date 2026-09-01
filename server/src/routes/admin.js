import { Router } from "express";
import ScrapeJob from "../models/ScrapeJob.js";
import Lead from "../models/Lead.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";
import { scrapeCompanyContactTiered } from "../services/scraperService.js";

const router = Router();
router.use(requireAuth);

router.get("/scrape-jobs", async (_req, res) => {
  const jobs = await ScrapeJob.find().sort({ createdAt: -1 }).limit(30).lean();
  res.json(jobs);
});

router.get("/scrape-jobs/:id", async (req, res) => {
  const job = await ScrapeJob.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
});

// Kicks off a Playwright deep scan (falling back from the fast static pass)
// and returns immediately with a job id — the scan itself runs in the
// background and the Admin page polls GET /scrape-jobs/:id for its result.
router.post("/scrape-jobs", async (req, res) => {
  const { domain, companyName, industry } = req.body || {};
  if (!domain || !companyName) return res.status(400).json({ error: "domain and companyName are required" });

  const job = await ScrapeJob.create({ domain, companyName, industry, status: "queued" });
  res.status(201).json(job);

  runScrapeJob(job._id).catch((err) => console.error(`[scrape-job ${job._id}] unhandled error:`, err));
});

async function runScrapeJob(jobId) {
  const job = await ScrapeJob.findById(jobId);
  if (!job) return;

  const agent = await Employee.findOne({ title: /Lead Scout/i });
  job.status = "running";
  job.startedAt = new Date();
  await job.save();
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Deep-scanning ${job.domain} (Playwright)` });

  try {
    const result = await scrapeCompanyContactTiered(job.domain);
    job.status = "done";
    job.tier = result.tier;
    job.result = { emails: result.emails, pagesOk: result.pagesOk, pagesTried: result.pagesTried };
    job.finishedAt = new Date();

    if (result.emails.length) {
      const lead = await Lead.create({
        companyName: job.companyName,
        industry: job.industry || "Unknown",
        website: result.website,
        contactEmail: result.emails[0],
        source: "website_scraper",
        sourceNote: `Deep scan (${result.tier}) — found on: ${result.pagesOk.join(", ")}`,
      });
      job.leadId = lead._id;
      await logActivity({
        actor: agent?._id,
        actorName: agent?.name || "Scout",
        department: "Operations",
        action: "Deep scan found contact",
        detail: `${job.companyName} — ${result.emails.length} email(s) via ${result.tier} scan`,
        entityType: "Lead",
        entityId: lead._id,
      });
    } else {
      await logActivity({
        actor: agent?._id,
        actorName: agent?.name || "Scout",
        department: "Operations",
        action: "Deep scan found nothing",
        detail: `${job.companyName} (${job.domain})`,
      });
    }
    await job.save();
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    job.finishedAt = new Date();
    await job.save();
  } finally {
    if (agent) await setAgentStatus(agent._id, { status: "idle", currentTask: "Standing by", bumpCompleted: true });
  }
}

export default router;
