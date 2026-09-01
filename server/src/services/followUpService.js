import Lead from "../models/Lead.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { generateFollowUpDraft } from "./llmService.js";
import { notify } from "./notifyService.js";

const FOLLOWUP_AFTER_DAYS = Number(process.env.FOLLOWUP_AFTER_DAYS || 4);

// Finds leads sitting in outreach_sent with no reply for FOLLOWUP_AFTER_DAYS
// and no follow-up drafted yet, and queues one nudge draft each — same
// human-approval gate as any other draft, nothing sends itself.
export async function runFollowUpCheck() {
  const cutoff = new Date(Date.now() - FOLLOWUP_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const leads = await Lead.find({ stage: "outreach_sent" }).lean();
  let queued = 0;

  for (const lead of leads) {
    // eslint-disable-next-line no-await-in-loop
    const original = await OutreachMessage.findOne({ lead: lead._id, status: "sent" }).sort({ sentAt: -1 });
    if (!original || !original.sentAt || original.sentAt > cutoff) continue;

    // eslint-disable-next-line no-await-in-loop
    const alreadyFollowedUp = await OutreachMessage.exists({ lead: lead._id, isFollowUp: true });
    if (alreadyFollowedUp) continue;

    const daysSinceSent = Math.floor((Date.now() - original.sentAt.getTime()) / (24 * 60 * 60 * 1000));

    try {
      // eslint-disable-next-line no-await-in-loop
      const { subject, body } = await generateFollowUpDraft({ channel: original.channel, lead, daysSinceSent });
      // eslint-disable-next-line no-await-in-loop
      const agent = await Employee.findOne({ title: /Outreach Drafter/i });
      // eslint-disable-next-line no-await-in-loop
      const msg = await OutreachMessage.create({
        lead: lead._id,
        channel: original.channel,
        subject,
        body,
        status: "draft",
        draftedBy: agent?._id,
        isFollowUp: true,
      });
      // eslint-disable-next-line no-await-in-loop
      if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Follow-up drafted for ${lead.companyName}`, bumpCompleted: true });
      // eslint-disable-next-line no-await-in-loop
      await logActivity({
        actor: agent?._id,
        actorName: agent?.name || "Quill",
        department: "Operations",
        action: "Follow-up draft generated",
        detail: `${lead.companyName} — ${daysSinceSent} days quiet`,
        entityType: "OutreachMessage",
        entityId: msg._id,
      });
      // eslint-disable-next-line no-await-in-loop
      await notify(`🔁 Follow-up drafted for *${lead.companyName}* (${daysSinceSent}d quiet) — awaiting your approval.`);
      queued += 1;
    } catch (err) {
      console.error(`[followUpService] failed for lead ${lead._id}:`, err.message);
    }
  }

  return { checked: leads.length, queued };
}
