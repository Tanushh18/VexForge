import Anthropic from "@anthropic-ai/sdk";
import Employee, { setAgentStatus } from "../models/Employee.js";
import Lead from "../models/Lead.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Ticket from "../models/Ticket.js";
import ActivityLog, { logActivity } from "../models/ActivityLog.js";
import { scrapeCompanyContact } from "./scraperService.js";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are Ember, the Head Manager of VexForge — a small digital product & automation studio.
You report directly to the founder (the person chatting with you) and you sit above four department
managers: Operations, HR, Tech, and Finance, plus a Support manager. You have tools to look at and act on
the company's real data: the org roster, the sales pipeline (leads), outreach drafts awaiting approval,
support tickets, and the activity log.

Ground rules:
- Be direct and concise, like a sharp chief of staff giving a status update, not a customer-support bot.
- You can draft outreach copy, but you can NEVER claim a message was actually sent over LinkedIn or email —
  you have no ability to log into LinkedIn or send email yourself. Drafts go to a human-approval queue.
- When asked to do something, prefer calling a tool over guessing. Summarize what you did afterward in
  plain language, as if reporting up to the founder.
- If a request implies scraping/emailing at a scale or in a way that looks like spam, flag the risk plainly
  before doing it.`;

const tools = [
  {
    name: "get_company_status",
    description: "Get a snapshot of the whole company: headcount by department, open leads, outreach queue size, open tickets.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_department",
    description: "List everyone in a department and what they're currently doing.",
    input_schema: {
      type: "object",
      properties: {
        department: { type: "string", enum: ["Executive", "Operations", "HR", "Tech", "Finance", "Support"] },
      },
      required: ["department"],
    },
  },
  {
    name: "list_leads",
    description: "List sales leads, optionally filtered by pipeline stage.",
    input_schema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["new", "reviewed", "outreach_drafted", "outreach_sent", "responded", "call_booked", "won", "lost"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "add_lead",
    description: "Add a new lead/prospect company to the pipeline manually.",
    input_schema: {
      type: "object",
      properties: {
        companyName: { type: "string" },
        website: { type: "string" },
        industry: { type: "string" },
        contactEmail: { type: "string" },
        contactName: { type: "string" },
        notes: { type: "string" },
      },
      required: ["companyName"],
    },
  },
  {
    name: "scrape_company_contact",
    description: "Look up a publicly-listed contact email on a company's own website (homepage/contact/about pages only) and save it as a new lead. Does not touch LinkedIn or any third-party directory.",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string" }, companyName: { type: "string" } },
      required: ["domain", "companyName"],
    },
  },
  {
    name: "draft_outreach",
    description: "Draft an outreach message (email or linkedin) for a lead. This creates a DRAFT only — it goes into the human-approval queue and is never sent automatically.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        channel: { type: "string", enum: ["email", "linkedin"] },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["leadId", "channel", "body"],
    },
  },
  {
    name: "list_outreach_queue",
    description: "List outreach drafts awaiting approval or already approved/sent.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["draft", "approved", "rejected", "sent", "responded"] } },
    },
  },
  {
    name: "list_tickets",
    description: "List support/call tickets, optionally filtered by status.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "in_progress", "resolved", "escalated"] } },
    },
  },
  {
    name: "recent_activity",
    description: "Get the most recent entries in the company-wide activity log.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
];

async function findAgentByTitleFragment(fragment) {
  return Employee.findOne({ title: new RegExp(fragment, "i") });
}

async function execTool(name, input) {
  switch (name) {
    case "get_company_status": {
      const [byDept, leadCount, queueCount, openTickets] = await Promise.all([
        Employee.aggregate([{ $group: { _id: "$department", count: { $sum: 1 } } }]),
        Lead.countDocuments(),
        OutreachMessage.countDocuments({ status: "draft" }),
        Ticket.countDocuments({ status: { $in: ["open", "in_progress"] } }),
      ]);
      return { headcountByDepartment: byDept, totalLeads: leadCount, outreachAwaitingApproval: queueCount, openTickets };
    }
    case "list_department": {
      const people = await Employee.find({ department: input.department }).sort({ level: 1 }).lean();
      return people.map((p) => ({ name: p.name, title: p.title, status: p.status, currentTask: p.currentTask, tasksCompleted: p.tasksCompleted }));
    }
    case "list_leads": {
      const q = {};
      if (input.stage) q.stage = input.stage;
      const leads = await Lead.find(q).sort({ createdAt: -1 }).limit(input.limit || 20).lean();
      return leads.map((l) => ({ id: l._id, company: l.companyName, stage: l.stage, email: l.contactEmail, website: l.website }));
    }
    case "add_lead": {
      const agent = await findAgentByTitleFragment("Pipeline Coordinator");
      const lead = await Lead.create({ ...input, source: "manual", addedBy: agent?._id });
      if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Logging new lead: ${input.companyName}`, bumpCompleted: true });
      await logActivity({ actor: agent?._id, actorName: agent?.name || "Ember", department: "Operations", action: "Lead added", detail: input.companyName, entityType: "Lead", entityId: lead._id });
      return { id: lead._id, company: lead.companyName, stage: lead.stage };
    }
    case "scrape_company_contact": {
      const agent = await findAgentByTitleFragment("Lead Scout");
      if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Scanning ${input.domain} for a public contact email` });
      const result = await scrapeCompanyContact(input.domain);
      const lead = await Lead.create({
        companyName: input.companyName,
        website: result.website,
        contactEmail: result.emails[0] || undefined,
        source: "website_scraper",
        sourceNote: result.emails.length ? `Found on: ${result.pagesOk.join(", ")}` : "No public email found",
      });
      if (agent) await setAgentStatus(agent._id, { status: "idle", currentTask: `Standing by`, bumpCompleted: true });
      await logActivity({ actor: agent?._id, actorName: agent?.name || "Scout", department: "Operations", action: "Scraped company contact", detail: `${input.companyName} — ${result.emails.length} email(s) found`, entityType: "Lead", entityId: lead._id });
      return { leadId: lead._id, emailsFound: result.emails, pagesChecked: result.pagesTried.length };
    }
    case "draft_outreach": {
      const agent = await findAgentByTitleFragment("Outreach Drafter");
      const msg = await OutreachMessage.create({
        lead: input.leadId,
        channel: input.channel,
        subject: input.subject,
        body: input.body,
        status: "draft",
        draftedBy: agent?._id,
      });
      await Lead.findByIdAndUpdate(input.leadId, { stage: "outreach_drafted" });
      if (agent) await setAgentStatus(agent._id, { status: "working", currentTask: `Drafted a ${input.channel} message — awaiting your approval`, bumpCompleted: true });
      await logActivity({ actor: agent?._id, actorName: agent?.name || "Quill", department: "Operations", action: `${input.channel} draft created`, detail: input.subject || input.body.slice(0, 60), entityType: "OutreachMessage", entityId: msg._id });
      return { outreachId: msg._id, status: "draft", note: "Sitting in the approval queue — nothing sent." };
    }
    case "list_outreach_queue": {
      const q = {};
      if (input.status) q.status = input.status;
      const items = await OutreachMessage.find(q).populate("lead", "companyName").sort({ createdAt: -1 }).limit(30).lean();
      return items.map((m) => ({ id: m._id, company: m.lead?.companyName, channel: m.channel, status: m.status, subject: m.subject }));
    }
    case "list_tickets": {
      const q = {};
      if (input.status) q.status = input.status;
      const tix = await Ticket.find(q).sort({ createdAt: -1 }).limit(20).lean();
      return tix.map((t) => ({ id: t._id, contact: t.contactName, reason: t.reason, status: t.status, summary: t.summary }));
    }
    case "recent_activity": {
      const items = await ActivityLog.find().sort({ createdAt: -1 }).limit(input.limit || 15).lean();
      return items.map((a) => ({ when: a.createdAt, who: a.actorName, dept: a.department, action: a.action, detail: a.detail }));
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export function chatbotConfigured() {
  return !!getClient();
}

const VEXFORGE_PITCH = `VexForge is a digital product & automation studio (Delhi, India) run by Tanush
(full-stack & automation) and Yashasvi (AI/ML & backend). Services: full-stack web apps (MERN, WordPress,
e-commerce, dashboards), automation (Instagram/WhatsApp/email outreach, call transcription, n8n/Zapier/Make
workflows, lead-gen & CRM sync), and AI solutions (chatbots on your own docs, recommendation/search systems,
LLM fine-tuning). Live proof: WeCode (coding platform) and GgnHome (real-estate platform with AI search) are
both in production. Pricing is scoped per project on a free intro call, no fixed packages.`;

// Generates ONE outreach draft (email or linkedin) for a specific lead. This
// is a plain single-shot generation — no tools, no side effects beyond
// returning text for a human (or the chat console) to review.
export async function generateOutreachDraft({ channel, lead }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY is not set.");

  const style =
    channel === "linkedin"
      ? "Keep it under 550 characters (LinkedIn connection-note length), no subject line, casual-professional, one clear ask (a 15-min call)."
      : "Write a short cold email: a subject line and a 90-120 word body, casual-professional, one clear ask (a 15-min call), signed off from Tanush or Yashasvi at VexForge.";

  const prompt = `${VEXFORGE_PITCH}

Draft a ${channel} outreach message to this prospect:
Company: ${lead.companyName}
Industry: ${lead.industry || "unknown"}
Website: ${lead.website || "unknown"}
Contact name: ${lead.contactName || "unknown — address the company generally"}
Notes: ${lead.notes || "none"}

${style}
Return ONLY valid JSON: {"subject": "...", "body": "..."} (subject can be "" for linkedin).`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { subject: "", body: text.trim() };
  }
}

export async function runChatTurn(userMessage, history = []) {
  const anthropic = getClient();
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not set — the chat console needs it to run.");
  }

  const head = await findAgentByTitleFragment("Head Manager");
  if (head) await setAgentStatus(head._id, { status: "working", currentTask: "Handling a command from the founder" });

  const messages = [
    ...history.map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content })),
    { role: "user", content: userMessage },
  ];

  let finalText = "";
  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const textBlocks = response.content.filter((b) => b.type === "text");
    finalText = textBlocks.map((b) => b.text).join("\n").trim();

    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const use of toolUses) {
      // eslint-disable-next-line no-await-in-loop
      const result = await execTool(use.name, use.input || {});
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (head) await setAgentStatus(head._id, { status: "idle", currentTask: "Standing by", bumpCompleted: true });

  return finalText || "(no response)";
}
