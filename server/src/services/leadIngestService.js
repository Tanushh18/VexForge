import Lead from "../models/Lead.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { findDuplicateLead } from "./leadRepository.js";
import { scoreLead } from "../../../shared/scoring.js";

// Takes the leads a local worker produced and lands them in the CRM.
//
// Dedupe happens *here*, not on the worker: the worker has no view of the CRM,
// and dedupe is the one rule that must not fork — two implementations is how
// the same company ends up in the pipeline twice. The worker's score is
// trusted (it ran the same shared scoring code, with the reasoning model right
// there on localhost), but a lead arriving unscored still gets the
// deterministic pass so nothing lands at zero.

function agentByTitle(fragment) {
  return Employee.findOne({ title: new RegExp(fragment, "i") });
}

export async function ingestLeads(leads = [], { workerId } = {}) {
  const drafter = await agentByTitle("Outreach Drafter");
  const result = { created: 0, duplicates: 0, drafted: 0, hot: 0, leadIds: [] };

  for (const incoming of leads) {
    if (!incoming?.companyName) continue;

    // eslint-disable-next-line no-await-in-loop
    const duplicate = await findDuplicateLead(incoming);
    if (duplicate) {
      result.duplicates += 1;
      continue;
    }

    const scored =
      typeof incoming.score === "number"
        ? { score: incoming.score, scoreBand: incoming.scoreBand, signals: incoming.signals, fitReason: incoming.fitReason }
        : scoreLead(incoming);

    // eslint-disable-next-line no-await-in-loop
    const lead = await Lead.create({
      companyName: incoming.companyName,
      website: incoming.website,
      industry: incoming.industry || "Unknown",
      contactEmail: incoming.contactEmail,
      contactName: incoming.contactName,
      notes: incoming.notes,
      source: "discovery",
      discoverySource: incoming.discoverySource,
      sourceUrl: incoming.sourceUrl,
      discoveredAt: incoming.discoveredAt || new Date(),
      sourceNote: incoming.sourceNote,
      verification: incoming.verification,
      ...scored,
      scoredAt: new Date(),
    });
    result.created += 1;
    result.leadIds.push(lead._id);
    if (lead.scoreBand === "hot") result.hot += 1;

    // The worker drafts locally (Ollama is on its own machine), so a draft
    // usually arrives with the lead. It still lands as `draft` — the approval
    // gate is server-side and the worker has no way past it.
    if (incoming.draft?.body) {
      // eslint-disable-next-line no-await-in-loop
      const msg = await OutreachMessage.create({
        lead: lead._id,
        channel: incoming.draft.channel || "email",
        subject: incoming.draft.subject,
        body: incoming.draft.body,
        status: "draft",
        draftedBy: drafter?._id,
      });
      lead.stage = "outreach_drafted";
      // eslint-disable-next-line no-await-in-loop
      await lead.save();
      result.drafted += 1;
      // eslint-disable-next-line no-await-in-loop
      await logActivity({
        actor: drafter?._id,
        actorName: drafter?.name || "Quill",
        department: "Operations",
        action: "Pipeline draft generated",
        detail: `${lead.companyName} (score ${lead.score})`,
        entityType: "OutreachMessage",
        entityId: msg._id,
      });
    }
  }

  const scout = await agentByTitle("Lead Scout");
  if (scout && result.created) {
    await setAgentStatus(scout._id, {
      status: "idle",
      currentTask: `Delivered ${result.created} new leads`,
      bumpCompleted: true,
    });
  }

  await logActivity({
    actorName: "Pipeline",
    department: "Operations",
    action: "Worker delivered leads",
    detail: `${result.created} new · ${result.duplicates} duplicate(s) · ${result.drafted} drafted (worker: ${workerId || "unknown"})`,
  });

  return result;
}
