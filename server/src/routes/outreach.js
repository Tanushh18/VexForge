import { Router } from "express";
import OutreachMessage from "../models/OutreachMessage.js";
import Lead from "../models/Lead.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";
import { generateOutreachDraft } from "../services/llmService.js";
import { sendApprovedEmail, emailIsConfigured } from "../services/emailService.js";
import { notify } from "../services/notifyService.js";
import { assertSendAllowed, quotaStatus } from "../services/sendQuotaService.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.channel) q.channel = req.query.channel;
  const items = await OutreachMessage.find(q).populate("lead").sort({ createdAt: -1 }).lean();
  res.json(items);
});

router.get("/config", async (_req, res) => {
  res.json({ emailConfigured: emailIsConfigured(), quota: await quotaStatus() });
});

// AI-drafts a message for a lead using Claude. Lands as status="draft" —
// nothing is sent, nothing leaves the building.
router.post("/generate", async (req, res) => {
  const { leadId, channel } = req.body || {};
  const lead = await Lead.findById(leadId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const agent = await Employee.findOne({ title: /Outreach Drafter/i });
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Drafting a ${channel} message for ${lead.companyName}` });

  const { subject, body } = await generateOutreachDraft({ channel, lead });
  const msg = await OutreachMessage.create({ lead: lead._id, channel, subject, body, status: "draft", draftedBy: agent?._id });
  await Lead.findByIdAndUpdate(lead._id, { stage: "outreach_drafted" });

  if (agent) await setAgentStatus(agent._id, { status: "idle", currentTask: "Standing by — draft ready for review", bumpCompleted: true });
  await logActivity({ actor: agent?._id, actorName: agent?.name || "Quill", department: "Product", action: `${channel} draft generated`, detail: lead.companyName, entityType: "OutreachMessage", entityId: msg._id });
  await notify(`✍️ New ${channel} draft for *${lead.companyName}* — awaiting your approval.`);

  res.status(201).json(msg);
});

// Manual draft creation/edit (e.g. you rewrite the AI draft before approving).
router.post("/", async (req, res) => {
  const msg = await OutreachMessage.create({ ...req.body, status: "draft" });
  res.status(201).json(msg);
});

router.patch("/:id", async (req, res) => {
  const msg = await OutreachMessage.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(msg);
});

// Transmits an approved email draft over SMTP and moves the lead forward.
// Shared by approve (which sends straight away) and the manual send button
// (for drafts that were approved while SMTP was down or the cap was hit).
async function deliverEmail(msg) {
  await assertSendAllowed();
  const agent = await Employee.findOne({ title: /Outreach Drafter/i });
  if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Sending email to ${msg.lead.companyName}` });
  try {
    await sendApprovedEmail({ to: msg.lead.contactEmail, subject: msg.subject, text: msg.body, html: msg.body.replace(/\n/g, "<br/>") });
  } finally {
    if (agent) await setAgentStatus(agent._id, { status: "idle", currentTask: "Standing by", bumpCompleted: true });
  }
  msg.status = "sent";
  msg.sentAt = new Date();
  msg.sentVia = "auto_email";
  await msg.save();
  await Lead.findByIdAndUpdate(msg.lead._id, { stage: "outreach_sent" });
  await logActivity({ actor: agent?._id, actorName: agent?.name || "Quill", department: "Product", action: "Email sent", detail: `${msg.lead.companyName} <${msg.lead.contactEmail}>`, entityType: "OutreachMessage", entityId: msg._id });
  await notify(`📨 Email sent to *${msg.lead.companyName}*.`);
  return msg;
}

// Approving an email draft sends it immediately when SMTP is configured and
// the lead has an address. If sending can't happen (no SMTP, no address, cap
// reached, SMTP error) the draft stays approved and `sendError` says why, so
// the Outreach page can offer the manual path.
router.post("/:id/approve", async (req, res) => {
  const msg = await OutreachMessage.findById(req.params.id).populate("lead");
  if (!msg) return res.status(404).json({ error: "Not found" });
  if (msg.status === "sent") return res.json(msg);
  msg.status = "approved";
  await msg.save();
  await logActivity({ actorName: "Founder", department: "Executive", action: "Outreach approved", detail: msg.lead?.companyName, entityType: "OutreachMessage", entityId: msg._id });

  if (msg.channel !== "email") return res.json(msg);
  if (!emailIsConfigured()) return res.json({ ...msg.toObject(), sendError: "SMTP isn't configured — send it manually." });
  if (!msg.lead?.contactEmail) return res.json({ ...msg.toObject(), sendError: "Lead has no contact email on file." });
  try {
    await deliverEmail(msg);
    res.json(msg);
  } catch (err) {
    await logActivity({ actorName: "Quill", department: "Product", action: "Email send failed", detail: `${msg.lead.companyName}: ${err.message}`, entityType: "OutreachMessage", entityId: msg._id });
    res.json({ ...msg.toObject(), sendError: err.message });
  }
});

router.post("/:id/reject", async (req, res) => {
  const msg = await OutreachMessage.findByIdAndUpdate(req.params.id, { status: "rejected", reviewNote: req.body?.reason }, { new: true });
  res.json(msg);
});

// The ONLY endpoint that can actually transmit anything, and only for
// email (SMTP) — LinkedIn has no send path here by design (see README).
router.post("/:id/send-email", async (req, res) => {
  const msg = await OutreachMessage.findById(req.params.id).populate("lead");
  if (!msg) return res.status(404).json({ error: "Not found" });
  if (msg.status !== "approved") return res.status(400).json({ error: "Only approved drafts can be sent" });
  if (msg.channel !== "email") return res.status(400).json({ error: "This endpoint only sends email drafts" });
  if (!msg.lead?.contactEmail) return res.status(400).json({ error: "Lead has no contact email on file" });

  try {
    await deliverEmail(msg);
  } catch (err) {
    return res.status(err.statusCode || 502).json({ error: err.message, quota: err.quota });
  }
  res.json(msg);
});

// For LinkedIn (and email when SMTP isn't set up): you send it yourself,
// then click this to mark it sent and move the lead's stage forward.
router.post("/:id/mark-sent", async (req, res) => {
  const msg = await OutreachMessage.findByIdAndUpdate(
    req.params.id,
    { status: "sent", sentAt: new Date(), sentVia: "manual" },
    { new: true }
  ).populate("lead");
  if (msg?.lead) await Lead.findByIdAndUpdate(msg.lead._id, { stage: "outreach_sent" });
  await logActivity({ actorName: "Founder", department: "Operations", action: `${msg.channel} marked sent (manual)`, detail: msg.lead?.companyName, entityType: "OutreachMessage", entityId: msg._id });
  res.json(msg);
});

export default router;
