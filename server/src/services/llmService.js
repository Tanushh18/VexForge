import Employee, { setAgentStatus } from "../models/Employee.js";
import Lead from "../models/Lead.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Ticket from "../models/Ticket.js";
import ActivityLog, { logActivity } from "../models/ActivityLog.js";

// Talks to the VexForge-LocalLLM service (a separate project — see its
// README) instead of a paid Claude/OpenAI API. That service wraps a locally
// running Qwen2.5 model via Ollama. Point LOCAL_LLM_URL at a tunnel URL if
// the model is running on a different machine than this server.
const LOCAL_LLM_URL = (process.env.LOCAL_LLM_URL || "http://localhost:5001").replace(/\/$/, "");

const VEXFORGE_PITCH = `VexForge is a digital product & automation studio (Delhi, India) run by Tanush
(full-stack & automation) and Yashasvi (AI/ML & backend). Services: full-stack web apps (MERN, WordPress,
e-commerce, dashboards), automation (Instagram/WhatsApp/email outreach, call transcription, n8n/Zapier/Make
workflows, lead-gen & CRM sync), and AI solutions (chatbots on your own docs, recommendation/search systems,
LLM fine-tuning). Live proof: WeCode (coding platform) and GgnHome (real-estate platform with AI search) are
both in production. Pricing is scoped per project on a free intro call, no fixed packages.`;

// --- Health polling -------------------------------------------------------
// chatbotConfigured() is called synchronously from a route handler, so we
// keep a small background poll and answer from cache rather than doing a
// live network round-trip on every request.
let healthy = false;
async function refreshHealth() {
  try {
    const res = await fetch(`${LOCAL_LLM_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    healthy = !!(data.ok && data.modelPulled);
  } catch {
    healthy = false;
  }
}
refreshHealth();
setInterval(refreshHealth, 15000).unref?.();

export function chatbotConfigured() {
  return healthy;
}

async function callLocalLLM(path, body) {
  const res = await fetch(`${LOCAL_LLM_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Local LLM service returned ${res.status}`);
  }
  return res.json();
}

// Generates ONE outreach draft (email or linkedin) for a specific lead —
// single-shot, no tools, no side effects beyond returning text.
export async function generateOutreachDraft({ channel, lead }) {
  if (!healthy) throw new Error("Local LLM service isn't reachable — is VexForge-LocalLLM running?");
  const { subject, body } = await callLocalLLM("/v1/generate-draft", {
    channel,
    pitch: VEXFORGE_PITCH,
    lead: {
      companyName: lead.companyName,
      industry: lead.industry,
      website: lead.website,
      contactName: lead.contactName,
      notes: lead.notes,
    },
  });
  return { subject, body };
}

// Drafts a polite nudge for a lead that's gone quiet after an initial
// message — same generator, framed as a follow-up rather than a first touch.
export async function generateFollowUpDraft({ channel, lead, daysSinceSent }) {
  if (!healthy) throw new Error("Local LLM service isn't reachable — is VexForge-LocalLLM running?");
  const { subject, body } = await callLocalLLM("/v1/generate-draft", {
    channel,
    pitch: `${VEXFORGE_PITCH}\n\nThis is a FOLLOW-UP — you already reached out ${daysSinceSent} days ago and
haven't heard back. Keep it brief, friendly, no guilt-tripping, and reference that this is a follow-up
without repeating the full original pitch.`,
    lead: {
      companyName: lead.companyName,
      industry: lead.industry,
      website: lead.website,
      contactName: lead.contactName,
      notes: lead.notes,
    },
  });
  return { subject, body };
}

// Tags a support ticket's urgency from its transcript — a hint for triage
// order, not authoritative; the human-set status field still governs.
export async function classifyTicketUrgency(transcript) {
  if (!healthy || !transcript) return "medium";
  try {
    const { urgency } = await callLocalLLM("/v1/classify", {
      text: transcript,
      categories: { urgency: ["low", "medium", "high"] },
    });
    return urgency || "medium";
  } catch {
    return "medium";
  }
}

export async function summarizeForDigest(instruction, data) {
  if (!healthy) return null;
  const { text } = await callLocalLLM("/v1/summarize", { instruction, data });
  return text;
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

const INTENTS = [
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

const HELP_TEXT = `I can give you a company status update, check a department, list leads (optionally by
stage), show the outreach queue, list support tickets, or recap recent activity. Try: "give me a status
update", "what's Operations working on", "list new leads", or "what happened recently".`;

export async function runChatTurn(userMessage, _history = []) {
  const head = await findAgentByTitleFragment("Head Manager");
  if (head) await setAgentStatus(head._id, { status: "working", currentTask: "Handling a command from the founder" });

  let reply;
  try {
    const intent = classify(userMessage);
    let data;
    let instruction;

    switch (intent) {
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
      if (!healthy) {
        reply = `Local model isn't reachable right now, but here's the raw data: ${JSON.stringify(data)}`;
      } else {
        const { text } = await callLocalLLM("/v1/summarize", { instruction, data });
        reply = text;
      }
    }
  } finally {
    if (head) await setAgentStatus(head._id, { status: "idle", currentTask: "Standing by", bumpCompleted: true });
  }

  return reply || "(no response)";
}
