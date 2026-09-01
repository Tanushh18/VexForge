import { Router } from "express";
import Lead from "../models/Lead.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";
import { scrapeCompanyContact } from "../services/scraperService.js";

const router = Router();
router.use(requireAuth);

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeDomain(website) {
  if (!website) return null;
  const d = website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return d || null;
}

// Same company already in the pipeline, by exact name or by website domain
// — added because nothing stopped the same lead being entered twice, either
// by hand or via repeated CSV imports.
async function findDuplicateLead({ companyName, website }) {
  const or = [{ companyName: new RegExp(`^${escapeRegex(companyName.trim())}$`, "i") }];
  const domain = normalizeDomain(website);
  if (domain) or.push({ website: new RegExp(escapeRegex(domain), "i") });
  return Lead.findOne({ $or: or });
}

// Fire-and-forget: if a manually-added lead has a website but no email on
// file, run the fast contact scan in the background and fill it in when it
// lands — the request doesn't wait on this.
function autoEnrich(lead) {
  if (!lead.website || lead.contactEmail) return;
  scrapeCompanyContact(lead.website)
    .then(async (result) => {
      if (!result.emails.length) return;
      await Lead.findByIdAndUpdate(lead._id, {
        contactEmail: result.emails[0],
        sourceNote: `Auto-enriched — found on: ${result.pagesOk.join(", ")}`,
      });
      await logActivity({
        actorName: "Scout",
        department: "Operations",
        action: "Auto-enriched lead",
        detail: `${lead.companyName} — found ${result.emails[0]}`,
        entityType: "Lead",
        entityId: lead._id,
      });
    })
    .catch((err) => console.error(`[autoEnrich] failed for lead ${lead._id}:`, err.message));
}

router.get("/", async (req, res) => {
  const q = {};
  if (req.query.stage) q.stage = req.query.stage;
  const leads = await Lead.find(q).sort({ createdAt: -1 }).lean();
  res.json(leads);
});

router.post("/", async (req, res) => {
  if (!req.body?.companyName) return res.status(400).json({ error: "companyName is required" });

  const duplicate = await findDuplicateLead(req.body);
  if (duplicate) {
    return res.status(409).json({ error: `Already in the pipeline as "${duplicate.companyName}"`, existingId: duplicate._id });
  }

  const lead = await Lead.create({ ...req.body, source: req.body.source || "manual" });
  const agent = await Employee.findOne({ title: /Pipeline Coordinator/i });
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Logged new lead: ${lead.companyName}`, bumpCompleted: true });
  await logActivity({ actor: agent?._id, actorName: agent?.name || "Operations", department: "Operations", action: "Lead added", detail: lead.companyName, entityType: "Lead", entityId: lead._id });

  autoEnrich(lead);
  res.status(201).json(lead);
});

// Minimal CSV parser (handles quoted fields, embedded commas/newlines) —
// header row required, column order doesn't matter as long as names match
// companyName/website/industry/contactEmail/contactName/notes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

router.post("/import-csv", async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== "string") return res.status(400).json({ error: "csv (raw text) is required" });

  const rows = parseCsv(csv);
  if (rows.length < 2) return res.status(400).json({ error: "No data rows found" });

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const companyNameIdx = idx("companyname");
  if (companyNameIdx === -1) return res.status(400).json({ error: 'CSV must have a "companyName" column' });

  const agent = await Employee.findOne({ title: /Pipeline Coordinator/i });
  let created = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const row of rows.slice(1)) {
    const companyName = row[companyNameIdx]?.trim();
    if (!companyName) { skippedInvalid += 1; continue; }

    const candidate = {
      companyName,
      website: idx("website") >= 0 ? row[idx("website")]?.trim() : undefined,
      industry: idx("industry") >= 0 ? row[idx("industry")]?.trim() : undefined,
      contactEmail: idx("contactemail") >= 0 ? row[idx("contactemail")]?.trim() : undefined,
      contactName: idx("contactname") >= 0 ? row[idx("contactname")]?.trim() : undefined,
      notes: idx("notes") >= 0 ? row[idx("notes")]?.trim() : undefined,
    };

    // eslint-disable-next-line no-await-in-loop
    const duplicate = await findDuplicateLead(candidate);
    if (duplicate) { skippedDuplicates += 1; continue; }

    // eslint-disable-next-line no-await-in-loop
    const lead = await Lead.create({ ...candidate, source: "csv_import" });
    autoEnrich(lead);
    created += 1;
  }

  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Imported ${created} leads from CSV`, bumpCompleted: true });
  await logActivity({
    actor: agent?._id,
    actorName: agent?.name || "Operations",
    department: "Operations",
    action: "CSV import",
    detail: `${created} added, ${skippedDuplicates} duplicate(s) skipped, ${skippedInvalid} invalid row(s) skipped`,
  });

  res.status(201).json({ created, skippedDuplicates, skippedInvalid, total: rows.length - 1 });
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

  const duplicate = await findDuplicateLead({ companyName, website: domain });
  if (duplicate) {
    return res.status(409).json({ error: `Already in the pipeline as "${duplicate.companyName}"`, existingId: duplicate._id });
  }

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
