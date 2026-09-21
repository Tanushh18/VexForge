import Employee, { setAgentStatus } from "../models/Employee.js";
import PipelineRun from "../models/PipelineRun.js";
import Lead from "../models/Lead.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Ticket from "../models/Ticket.js";
import ActivityLog, { logActivity } from "../models/ActivityLog.js";

import { complete, completeJson, llmReady } from "../../../shared/modelRouter.js";
export { generateOutreachDraft, generateFollowUpDraft } from "../../../shared/outreach.js";

// All inference goes through modelRouter, which picks a *local* model per
// role: `drafting` for outreach copy, `fast` for classification and one-line
// summaries, `reasoning` for anything that changes what the pipeline does.
// No paid API, and no single model asked to be good at everything.
//
// Draft generation itself lives in shared/outreach.js because the local
// worker drafts too, at the end of a pipeline run — it's re-exported here so
// existing callers don't have to care where it moved to.

export function chatbotConfigured() {
  return llmReady();
}

// Tags a support ticket's urgency from its transcript — a hint for triage
// order, not authoritative; the human-set status field still governs. Runs on
// the `fast` model: it fires on every ticket and a one-word answer doesn't
// need a 14B model.
export async function classifyTicketUrgency(transcript) {
  if (!transcript || !llmReady()) return "medium";
  try {
    const result = await completeJson("fast", {
      system: 'Classify the urgency of this support transcript. Reply with JSON only: {"urgency":"low"|"medium"|"high"}',
      prompt: transcript.slice(0, 4000),
      timeoutMs: 30000,
    });
    const urgency = result?.urgency;
    return ["low", "medium", "high"].includes(urgency) ? urgency : "medium";
  } catch {
    return "medium";
  }
}

// The weekly digest is a judgement call about what mattered, so it goes to
// the reasoning model rather than the fast one.
export async function summarizeForDigest(instruction, data) {
  if (!llmReady()) return null;
  try {
    return await complete("reasoning", {
      system: "You are a chief of staff writing an internal weekly digest. Plain English, no bullet points.",
      prompt: `${instruction}\n\n${JSON.stringify(data)}`,
      timeoutMs: 120000,
    });
  } catch (err) {
    console.error("[digest] summarize failed:", err.message);
    return null;
  }
}

// --- Deterministic intent router -------------------------------------------
// A 3B-parameter local model is not reliable at picking the right tool out
// of many across a multi-turn agentic loop the way Claude was — it drifts,
// mixes up arguments, or ignores tools entirely. Instead of porting that
// loop, routing is done in plain Node (regex/keyword matching, which is
// exactly what these commands look like anyway), the matched tool runs
// deterministically, and the local model is only asked to do the one thing
// small models are actually good at: turning a JSON result into a fluent
// status-update sentence.

const DEPARTMENTS = ["Executive", "Operations", "HR", "Tech", "Finance", "Support"];
const LEAD_STAGES = ["new", "reviewed", "outreach_drafted", "outreach_sent", "responded", "call_booked", "won", "lost"];
const OUTREACH_STATUSES = ["draft", "approved", "rejected", "sent", "responded"];
const TICKET_STATUSES = ["open", "in_progress", "resolved", "escalated"];

export function findEnumMention(text, values) {
  const lower = text.toLowerCase();
  return values.find((v) => lower.includes(v.toLowerCase().replace(/_/g, " ")) || lower.includes(v.toLowerCase()));
}

async function findAgentByTitleFragment(fragment) {
  return Employee.findOne({ title: new RegExp(fragment, "i") });
}

async function toolGetCompanyStatus() {
  const [byDept, leadCount, queueCount, openTickets] = await Promise.all([
    Employee.aggregate([{ $group: { _id: "$department", count: { $sum: 1 } } }]),
    Lead.countDocuments(),
    OutreachMessage.countDocuments({ status: "draft" }),
    Ticket.countDocuments({ status: { $in: ["open", "in_progress"] } }),
  ]);
  return { headcountByDepartment: byDept, totalLeads: leadCount, outreachAwaitingApproval: queueCount, openTickets };
}

async function toolListDepartment(department) {
  const people = await Employee.find({ department }).sort({ level: 1 }).lean();
  return people.map((p) => ({ name: p.name, title: p.title, status: p.status, currentTask: p.currentTask, tasksCompleted: p.tasksCompleted }));
}

async function toolListLeads(stage) {
  const q = stage ? { stage } : {};
  const leads = await Lead.find(q).sort({ createdAt: -1 }).limit(20).lean();
  return leads.map((l) => ({ company: l.companyName, stage: l.stage, email: l.contactEmail, website: l.website }));
}

async function toolListOutreachQueue(status) {
  const q = status ? { status } : {};
  const items = await OutreachMessage.find(q).populate("lead", "companyName").sort({ createdAt: -1 }).limit(30).lean();
  return items.map((m) => ({ company: m.lead?.companyName, channel: m.channel, status: m.status, subject: m.subject }));
}

async function toolListTickets(status) {
  const q = status ? { status } : {};
  const tix = await Ticket.find(q).sort({ createdAt: -1 }).limit(20).lean();
  return tix.map((t) => ({ contact: t.contactName, reason: t.reason, status: t.status }));
}

async function toolRecentActivity() {
  const items = await ActivityLog.find().sort({ createdAt: -1 }).limit(15).lean();
  return items.map((a) => ({ when: a.createdAt, who: a.actorName, dept: a.department, action: a.action, detail: a.detail }));
}

async function toolPipelineStatus() {
  const runs = await PipelineRun.find().sort({ createdAt: -1 }).limit(5).lean();
  const [hot, warm] = await Promise.all([
    Lead.countDocuments({ scoreBand: "hot" }),
    Lead.countDocuments({ scoreBand: "warm" }),
  ]);
  return {
    hotLeads: hot,
    warmLeads: warm,
    recentRuns: runs.map((r) => ({ when: r.createdAt, status: r.status, trigger: r.trigger, ...r.stats })),
  };
}

const INTENTS = [
  // Ahead of "leads", since "how's the lead pipeline doing" should report the
  // pipeline's runs rather than listing every lead in the CRM.
  { name: "pipeline", pattern: /\b(pipeline|discovery|scrape run|lead run|sourcing)\b/i },
  { name: "status", pattern: /\b(status|overview|update|how (are|is) (things|we|the company))\b/i },
  { name: "department", pattern: /\b(department|team)\b/i },
  { name: "leads", pattern: /\bleads?\b/i },
  { name: "outreach", pattern: /\b(outreach|queue|draft(s|ed)?)\b/i },
  { name: "tickets", pattern: /\b(tickets?|support|call)\b/i },
  { name: "activity", pattern: /\b(activity|happened|log)\b/i },
];

export function classify(message) {
  for (const intent of INTENTS) {
    if (intent.pattern.test(message)) return intent.name;
  }
  return null;
}

const HELP_TEXT = `I can give you a company status update, report on the lead pipeline, check a department,
list leads (optionally by stage), show the outreach queue, list support tickets, or recap recent activity.
Try: "give me a status update", "how's the pipeline doing", "what's Operations working on", "list new
leads", or "what happened recently".`;

export async function runChatTurn(userMessage, _history = []) {
  const head = await findAgentByTitleFragment("Head Manager");
  if (head) await setAgentStatus(head._id, { status: "working", currentTask: "Handling a command from the founder" });

  let reply;
  try {
    const intent = classify(userMessage);
    let data;
    let instruction;

    switch (intent) {
      case "pipeline":
        data = await toolPipelineStatus();
        instruction = "Summarize how the lead-generation pipeline is performing.";
        break;
      case "status":
        data = await toolGetCompanyStatus();
        instruction = "Summarize this company status update like a chief of staff.";
        break;
      case "department": {
        const dept = findEnumMention(userMessage, DEPARTMENTS) || "Operations";
        data = { department: dept, people: await toolListDepartment(dept) };
        instruction = `Summarize what the ${dept} department is currently working on.`;
        break;
      }
      case "leads": {
        const stage = findEnumMention(userMessage, LEAD_STAGES);
        data = { stageFilter: stage || "all", leads: await toolListLeads(stage) };
        instruction = "Summarize this list of sales leads.";
        break;
      }
      case "outreach": {
        const status = findEnumMention(userMessage, OUTREACH_STATUSES);
        data = { statusFilter: status || "all", items: await toolListOutreachQueue(status) };
        instruction = "Summarize this outreach queue.";
        break;
      }
      case "tickets": {
        const status = findEnumMention(userMessage, TICKET_STATUSES);
        data = { statusFilter: status || "all", tickets: await toolListTickets(status) };
        instruction = "Summarize these support tickets.";
        break;
      }
      case "activity":
        data = { recent: await toolRecentActivity() };
        instruction = "Recap this recent activity log in a couple of sentences.";
        break;
      default:
        reply = HELP_TEXT;
    }

    if (!reply) {
      if (!llmReady()) {
        reply = `Local model isn't reachable right now, but here's the raw data: ${JSON.stringify(data)}`;
      } else {
        reply = await complete("fast", {
          system: "You are Ember, the chief of staff. Answer in two or three plain sentences. No bullet points.",
          prompt: `${instruction}\n\n${JSON.stringify(data)}`,
          timeoutMs: 60000,
        });
      }
    }
  } finally {
    if (head) await setAgentStatus(head._id, { status: "idle", currentTask: "Standing by", bumpCompleted: true });
  }

  return reply || "(no response)";
}
