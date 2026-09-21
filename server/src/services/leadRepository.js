import Lead from "../models/Lead.js";

// Lead identity and dedupe, shared by every path that can create a lead: the
// manual form, CSV import, the single-domain scraper, and the discovery
// pipeline. These used to live in routes/leads.js, which meant the pipeline
// would have had to re-implement them — and a second, subtly different
// dedupe rule is how the same company ends up in the CRM twice.

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeDomain(website) {
  if (!website) return null;
  const d = website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return d || null;
}

export async function findDuplicateLead({ companyName, website }) {
  const or = [];
  if (companyName) or.push({ companyName: new RegExp(`^${escapeRegex(companyName.trim())}$`, "i") });
  const domain = normalizeDomain(website);
  if (domain) or.push({ website: new RegExp(escapeRegex(domain), "i") });
  if (!or.length) return null;
  return Lead.findOne({ $or: or });
}
