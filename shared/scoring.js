import { complete, completeJson } from "./modelRouter.js";

// Shared by the deployed server and the local worker. Kept dependency-free on
// purpose: both sides import it by relative path, so anything it pulled in
// would have to exist in two package.json files that can drift apart.

// Ranks leads so a ~25-sends-a-day budget goes to the prospects most likely to
// convert. Two layers, deliberately in this order:
//
//   1. Deterministic scoring from observed signals. Reproducible, testable,
//      and works with no model running at all.
//   2. An optional adjustment from the local *reasoning* model, clamped to
//      ±15 points. The model can re-rank within a band; it cannot promote a
//      cold lead to hot or overrule a missing contact path.
//
// A score is a queue ordering, never a send authorization — every message
// still passes the human approval gate.

export const SIGNAL_WEIGHTS = {
  just_funded: 30, // strongest buying signal: budget exists and is new
  just_launched: 25, // needs a site/infra now, before a vendor is entrenched
  hiring: 15, // growing, and hiring devs often means unmet build capacity
  target_industry: 12, // matches what VexForge has shipped before
  has_contact_email: 20, // without this there is no outreach path at all
  has_founder_name: 8, // personalized first line lands better than "Hi there"
  has_website: 5,
  no_contact_path: -20, // no email and no site to scrape one from
  too_large: -15, // enterprise procurement is not this studio's lane
  agency_or_competitor: -25, // another studio is not a client
};

// Industries VexForge has live proof in (WeCode, GgnHome) plus the adjacent
// ones its stack maps onto cleanly.
const TARGET_INDUSTRIES = [
  "edtech", "education", "real estate", "proptech", "saas", "ecommerce", "e-commerce",
  "marketplace", "fintech", "healthtech", "d2c", "logistics", "travel", "hospitality",
];

const AGENCY_WORDS = ["agency", "studio", "consultancy", "consulting", "software services", "it services", "web design"];

const SIZE_PENALTY = { "mid (51-200)": "too_large" };

export function detectSignals(lead = {}) {
  const signals = new Set(Array.isArray(lead.signals) ? lead.signals : []);
  const haystack = [lead.companyName, lead.industry, lead.notes, lead.sourceNote]
    .filter(Boolean).join(" ").toLowerCase();

  if (lead.contactEmail) signals.add("has_contact_email");
  if (lead.website) signals.add("has_website");
  if (lead.contactName) signals.add("has_founder_name");
  if (!lead.contactEmail && !lead.website) signals.add("no_contact_path");

  if (TARGET_INDUSTRIES.some((i) => haystack.includes(i))) signals.add("target_industry");
  if (AGENCY_WORDS.some((w) => haystack.includes(w))) signals.add("agency_or_competitor");

  const sizeSignal = SIZE_PENALTY[lead.sizeGuess];
  if (sizeSignal) signals.add(sizeSignal);

  return [...signals];
}

export function bandFor(score) {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cold";
}

// Base 30 so a lead with a site and an email but no timing signal still lands
// mid-cold rather than at zero — it's a worse prospect, not a non-prospect.
export function scoreLead(lead = {}) {
  const signals = detectSignals(lead);
  const raw = signals.reduce((sum, s) => sum + (SIGNAL_WEIGHTS[s] || 0), 30);
  const score = Math.max(0, Math.min(100, raw));
  return { score, signals, scoreBand: bandFor(score) };
}

const FIT_SYSTEM = `You score B2B sales leads for VexForge, a two-person digital product and automation
studio in Delhi that builds full-stack web apps, AWS setups, databases and workflow automation for early
startups. You are given a lead and a deterministic base score. Reply with JSON only:
{"adjustment": <integer -15..15>, "reason": "<one short sentence>"}.
Positive adjustment = better fit than the base score suggests. Be conservative; 0 is a fine answer.`;

export const MAX_MODEL_ADJUSTMENT = 15;

export function applyAdjustment(base, adjustment) {
  const clamped = Math.max(-MAX_MODEL_ADJUSTMENT, Math.min(MAX_MODEL_ADJUSTMENT, Math.round(Number(adjustment) || 0)));
  return Math.max(0, Math.min(100, base + clamped));
}

// The reasoning model's pass. Any failure — model down, bad JSON, timeout —
// returns the deterministic score unchanged rather than throwing: scoring runs
// inside a batch pipeline, and one flaky inference must not stall the run.
export async function scoreLeadWithModel(lead) {
  const base = scoreLead(lead);
  try {
    const result = await completeJson("reasoning", {
      system: FIT_SYSTEM,
      prompt: JSON.stringify({
        companyName: lead.companyName,
        industry: lead.industry,
        website: lead.website,
        description: lead.notes,
        observedSignals: base.signals,
        baseScore: base.score,
      }),
      timeoutMs: 60000,
    });
    if (!result || typeof result.adjustment === "undefined") return base;

    const score = applyAdjustment(base.score, result.adjustment);
    return {
      score,
      signals: base.signals,
      scoreBand: bandFor(score),
      fitReason: typeof result.reason === "string" ? result.reason.slice(0, 300) : undefined,
    };
  } catch (err) {
    console.error(`[scoring] model pass failed for ${lead.companyName}:`, err.message);
    return base;
  }
}

// Used by the digest and the pipeline summary — a plain-English read on a
// batch, generated by the same reasoning model that did the scoring.
export async function summarizeBatch(leads) {
  if (!leads.length) return null;
  try {
    return await complete("reasoning", {
      system: "You are an operations lead. Two or three sentences, plain English, no bullet points.",
      prompt: `Summarize this batch of newly discovered sales leads and say which one or two are worth
contacting first and why:\n${JSON.stringify(
        leads.map((l) => ({ company: l.companyName, score: l.score, band: l.scoreBand, signals: l.signals })).slice(0, 25)
      )}`,
      timeoutMs: 90000,
    });
  } catch {
    return null;
  }
}
