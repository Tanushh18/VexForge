import { Router } from "express";
import Lead from "../models/Lead.js";
import Ticket from "../models/Ticket.js";
import { logActivity } from "../models/ActivityLog.js";

const router = Router();

// The ONLY unauthenticated, public-facing endpoint — the contact form on
// the marketing site (website/index.html). Someone filling this in is
// opting in themselves, which is the cleanest possible lead source: no
// scraping, no cold list, they came to you.
router.post("/contact", async (req, res) => {
  const { name, email, company, message } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "name and email are required" });

  const lead = await Lead.create({
    companyName: company || `${name} (individual inquiry)`,
    contactName: name,
    contactEmail: email,
    source: "referral",
    sourceNote: "Submitted the website contact form",
    stage: "responded",
    notes: message,
  });

  const ticket = await Ticket.create({
    contactName: name,
    contactEmail: email,
    company,
    channel: "chat",
    reason: "sales",
    status: "open",
    transcript: message,
    summary: "New inbound inquiry from the website contact form",
  });

  await logActivity({
    actorName: "Website",
    department: "Operations",
    action: "Inbound contact form submission",
    detail: `${name} <${email}>${company ? ` — ${company}` : ""}`,
    entityType: "Lead",
    entityId: lead._id,
  });

  res.status(201).json({ ok: true, leadId: lead._id, ticketId: ticket._id });
});

export default router;
