import { Router } from "express";
import Lead from "../models/Lead.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";
import { scrapeCompanyContact } from "../services/scraperService.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const q = {};
  if (req.query.stage) q.stage = req.query.stage;
  const leads = await Lead.find(q).sort({ createdAt: -1 }).lean();
  res.json(leads);
});

router.post("/", async (req, res) => {
  const lead = await Lead.create({ ...req.body, source: req.body.source || "manual" });
  const agent = await Employee.findOne({ title: /Pipeline Coordinator/i });
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Logged new lead: ${lead.companyName}`, bumpCompleted: true });
  await logActivity({ actor: agent?._id, actorName: agent?.name || "Operations", department: "Operations", action: "Lead added", detail: lead.companyName, entityType: "Lead", entityId: lead._id });
  res.status(201).json(lead);
});

router.patch("/:id", async (req, res) => {
  const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(lead);
});

router.delete("/:id", async (req, res) => {
  await Lead.findByIdAndDelete(req.params.id);
  res.status(204).end();
});

// Kick off the public-website contact scraper for one or more domains.
// See services/scraperService.js for exactly what this does and doesn't touch.
router.post("/scrape", async (req, res) => {
  const { domain, companyName, industry } = req.body || {};
  if (!domain || !companyName) return res.status(400).json({ error: "domain and companyName are required" });

  const agent = await Employee.findOne({ title: /Lead Scout/i });
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Scanning ${domain} for a public contact email` });

  const result = await scrapeCompanyContact(domain);
  const lead = await Lead.create({
    companyName,
    industry: industry || "Unknown",
    website: result.website,
    contactEmail: result.emails[0],
    source: "website_scraper",
    sourceNote: result.emails.length ? `Found on: ${result.pagesOk.join(", ")}` : "No public email found on scanned pages",
  });

  if (agent) await setAgentStatus(agent._id, { status: "idle", currentTask: "Standing by", bumpCompleted: true });
  await logActivity({ actor: agent?._id, actorName: agent?.name || "Scout", department: "Operations", action: "Website scraped for contact", detail: `${companyName} (${domain}) — ${result.emails.length} email(s)`, entityType: "Lead", entityId: lead._id });

  res.status(201).json({ lead, scraped: result });
});

export default router;
