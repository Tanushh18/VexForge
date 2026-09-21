import { completeJson } from "./modelRouter.js";

// Outreach draft generation, shared by the deployed server (the "Generate
// draft" button, follow-up nudges) and the local worker (drafting at the end
// of a pipeline run). Pure: takes a plain lead object, returns text. No
// database, no dependencies.

export const VEXFORGE_PITCH = `VexForge is a digital product & automation studio (Delhi, India) run by Tanush
(full-stack & automation) and Yashasvi (AI/ML & backend). Services: full-stack web apps (MERN, WordPress,
e-commerce, dashboards), automation (Instagram/WhatsApp/email outreach, call transcription, n8n/Zapier/Make
workflows, lead-gen & CRM sync), and AI solutions (chatbots on your own docs, recommendation/search systems,
LLM fine-tuning). Live proof: WeCode (coding platform) and GgnHome (real-estate platform with AI search) are
both in production. Pricing is scoped per project on a free intro call, no fixed packages.`;

export function draftSystemPrompt(channel, extra = "") {
  return `You write short, specific B2B outreach for VexForge. Channel: ${channel}.
${VEXFORGE_PITCH}
${extra}
Rules: under 140 words, no buzzwords, no "I hope this finds you well", reference something concrete about
the company, and end with one low-friction ask (a 15-minute call). Reply with JSON only:
{"subject": "<short subject, empty string for linkedin>", "body": "<the message>"}`;
}

export function leadBrief(lead) {
  return JSON.stringify({
    companyName: lead.companyName,
    industry: lead.industry,
    website: lead.website,
    contactName: lead.contactName,
    notes: lead.notes,
    signals: lead.signals,
  });
}

// Runs on the `drafting` model: fluency matters here, judgement less so.
export async function generateOutreachDraft({ channel, lead }) {
  const result = await completeJson("drafting", {
    system: draftSystemPrompt(channel),
    prompt: leadBrief(lead),
    timeoutMs: 120000,
  });
  if (!result?.body) throw new Error("The drafting model returned no usable message — check `ollama ps`.");
  return { subject: result.subject || `Quick idea for ${lead.companyName}`, body: result.body };
}

// Same generator, framed as a nudge rather than a first touch.
export async function generateFollowUpDraft({ channel, lead, daysSinceSent }) {
  const result = await completeJson("drafting", {
    system: draftSystemPrompt(
      channel,
      `This is a FOLLOW-UP — you already reached out ${daysSinceSent} days ago and heard nothing back. Keep it
brief and friendly, no guilt-tripping, reference that it's a follow-up, and do not repeat the full pitch.`
    ),
    prompt: leadBrief(lead),
    timeoutMs: 120000,
  });
  if (!result?.body) throw new Error("The drafting model returned no usable follow-up message.");
  return { subject: result.subject || `Following up — ${lead.companyName}`, body: result.body };
}
