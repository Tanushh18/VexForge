import { discoverLeads } from "./leadSources/index.js";
import { scrapeCompanyContactTiered } from "./scraper.js";
import { resolveWebsite } from "./resolveWebsite.js";
import { verifySite, pickVerifiedEmail, domainAgeDays, mergeBySite, mapLimit, hostOf } from "./verify.js";
import { scoreLead, scoreLeadWithModel, summarizeBatch } from "../../shared/scoring.js";
import { generateOutreachDraft } from "../../shared/outreach.js";
import { llmReady, refreshModelHealth } from "../../shared/modelRouter.js";
import { reportProgress, deliverLeads, finishRun, finishScan } from "./apiClient.js";

// The end-to-end run, executed here rather than on the server because every
// stage below either drives Chromium or needs a local model:
//
//   1. discover  public listing sites (Product Hunt, HN launches, YC, …)
//   2. merge     the same company from several sources becomes one lead
//   3. verify    the website is live and really the company's (verify.js)
//   4. enrich    an email from the company's OWN site, verified (MX etc.)
//   5. score     deterministic signals from verified facts; low scores dropped
//   6. draft     outreach for the top N, via Groq's drafting model
//   7. deliver   POST to the deployed API, which owns dedupe and storage
//
// Dedupe deliberately does NOT happen here: the worker has no view of the CRM,
// and a second implementation of that rule is how the same company ends up in
// the pipeline twice.

// Leads go up in small batches rather than one big POST at the end, so a run
// that dies halfway still leaves you the companies it already found.
const DELIVER_BATCH = 5;

// A contact email is mandatory: a lead the CRM can never send to is dead
// weight in the pipeline, not a prospect to review later. Applied after the
// full tiered enrichment pass (static site scan, Playwright fallback if that
// found nothing), so this is the true floor — nothing left to try before
// dropping it. Pure and separately testable from the network-heavy run.
export function partitionByContact(leads) {
  const withContact = [];
  const dropped = [];
  for (const lead of leads) (lead.contactEmail ? withContact : dropped).push(lead);
  return { withContact, dropped };
}

export async function runDiscoveryJob(job) {
  const runId = job.id;
  const opts = job.options || {};
  const stats = { discovered: 0, resolved: 0, duplicates: 0, created: 0, enriched: 0, verified: 0, rejected: 0, scored: 0, drafted: 0, hot: 0 };
  const rejections = {};
  const reject = (lead, reason) => {
    stats.rejected += 1;
    rejections[reason] = (rejections[reason] || 0) + 1;
    console.log(`[verify] drop ${lead.companyName} (${lead.website || "no site"}): ${reason}`);
  };
  let sourceResults = [];

  const progress = (stage, note, percent) => reportProgress(runId, { stage, note, percent, stats, sourceResults });

  try {
    await refreshModelHealth();

    // --- 1. Discover -------------------------------------------------------
    await progress("discover", `Crawling ${(opts.sources || []).length} source(s)…`, 5);
    const results = await discoverLeads({ sources: opts.sources, perSource: opts.perSource });
    sourceResults = results.map(({ source, ok, found, error }) => ({ source, ok, found, error }));

    const raw = results.flatMap((r) => r.leads.map((l) => ({ ...l, discoverySource: r.source })));
    stats.discovered = raw.length;

    // --- 2. Find websites for name-only leads, then merge ---------------------
    // Funding headlines carry a name but no URL; the resolver guesses the
    // domain and only keeps it if the live site names the company. Resolving
    // before the merge lets a funded company collapse into its Product Hunt
    // or HN listing and pick up both signals.
    const nameOnly = raw.filter((l) => !l.website);
    if (nameOnly.length && opts.resolveWebsites !== false) {
      await progress("dedupe", `Finding websites for ${nameOnly.length} name-only leads…`, 15);
      const resolved = await mapLimit(nameOnly, 4, (l) => resolveWebsite(l.companyName).catch(() => null));
      nameOnly.forEach((lead, i) => {
        if (!resolved[i]) return;
        lead.website = resolved[i].website;
        stats.resolved = (stats.resolved || 0) + 1;
      });
    }
    const candidates = mergeBySite(raw);
    await progress("dedupe", `Found ${raw.length} listings → ${candidates.length} unique companies`, 20);

    if (!candidates.length) {
      await finishRun(runId, { status: "done", summary: "No companies found — the sources returned nothing.", sourceResults, stats });
      return stats;
    }

    // --- 3. Verify the website is a real, live company site -----------------
    // One homepage GET per company, a few hosts at a time (each host still
    // sees a single request). Done before enrichment so no time is spent
    // crawling contact pages of dead or parked domains.
    await progress("verify", `Checking ${candidates.length} websites are live…`, 22);
    const siteChecks = await mapLimit(candidates, 6, async (lead) => {
      if (!lead.website) return { ok: false, reason: "no_website" };
      const [site, ageDays] = await Promise.all([verifySite(lead.website), domainAgeDays(hostOf(lead.website))]);
      return { ...site, ageDays };
    });
    const liveSites = [];
    candidates.forEach((lead, i) => {
      const check = siteChecks[i];
      if (!check.ok) return reject(lead, `site:${check.reason}`);
      for (const s of check.signals) if (!lead.signals.includes(s)) lead.signals.push(s);
      if (check.ageDays != null && check.ageDays < 365) lead.signals.push("new_domain");
      lead.verification = { siteOk: true, siteTitle: check.title, domainAgeDays: check.ageDays ?? undefined, seenIn: lead.seenIn };
      liveSites.push(lead);
    });
    await progress("verify", `${liveSites.length}/${candidates.length} sites verified live`, 30);

    // --- 4. Enrich + verify a contact email ---------------------------------
    // Sequential and unhurried on purpose: this crawls each company's own
    // contact pages, which is the politeness contract the scraper is built on.
    const verifiedLeads = [];
    for (const [i, lead] of liveSites.entries()) {
      await progress("enrich", `Finding a verified email — ${lead.companyName} (${i + 1}/${liveSites.length})`, 30 + Math.round((i / Math.max(1, liveSites.length)) * 35));
      let emails = lead.contactEmail ? [lead.contactEmail] : [];
      let foundOn = null;
      if (opts.enrich !== false) {
        try {
          // A static pass whose emails all fail verification is worth a
          // browser pass too, so verification decides whether to stop.
          // eslint-disable-next-line no-await-in-loop
          const found = await scrapeCompanyContactTiered(lead.website, {
            accept: async (list) => (await pickVerifiedEmail([...emails, ...list], lead.website)).ok,
          });
          emails = [...emails, ...found.emails];
          foundOn = found.pagesOk?.[0] || found.website;
        } catch (err) {
          console.error(`[worker] enrich failed for ${lead.companyName}: ${err.message}`);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      const email = await pickVerifiedEmail(emails, lead.website);
      if (!email.ok) {
        reject(lead, `email:${email.reason}`);
        continue;
      }
      if (email.email !== lead.contactEmail) stats.enriched += 1;
      lead.contactEmail = email.email;
      for (const s of email.signals) if (!lead.signals.includes(s)) lead.signals.push(s);
      Object.assign(lead.verification, { emailOk: true, mx: email.mx, verifiedAt: new Date().toISOString() });
      const seen = lead.seenIn.length > 1 ? ` (also listed on ${lead.seenIn.slice(1).join(", ")})` : "";
      lead.sourceNote = `Discovered via ${lead.discoverySource}${seen} · site verified live · email ${email.email} verified (MX ok)${foundOn ? ` · found on ${foundOn}` : ""}`;
      stats.verified += 1;
      verifiedLeads.push(lead);
    }

    if (!verifiedLeads.length) {
      await finishRun(runId, {
        status: "done",
        summary: `Found ${candidates.length} companies; none passed verification (${formatRejections(rejections)}).`,
        sourceResults,
        stats,
      });
      return stats;
    }

    // --- 5. Score ----------------------------------------------------------
    // Deterministic by default: every point traces back to a verified fact.
    // The model adjustment is opt-in (options.useModelScoring === true).
    const useModel = opts.useModelScoring === true && llmReady();
    for (const [i, lead] of verifiedLeads.entries()) {
      await progress("score", `Scoring ${lead.companyName} (${i + 1}/${verifiedLeads.length})`, 65 + Math.round((i / verifiedLeads.length) * 10));
      // eslint-disable-next-line no-await-in-loop
      const scored = useModel ? await scoreLeadWithModel(lead) : scoreLead(lead);
      Object.assign(lead, scored);
      stats.scored += 1;
    }

    // Only prospects with a real chance of converting go to the CRM.
    const minDeliver = opts.minDeliverScore ?? 45;
    const deliverable = verifiedLeads.filter((l) => l.score >= minDeliver).sort((a, b) => b.score - a.score);
    for (const l of verifiedLeads) if (l.score < minDeliver) reject(l, "low_score");

    // --- 6. Draft the top slice -------------------------------------------
    const minScore = opts.minDraftScore ?? 60;
    const draftable = deliverable.filter((l) => l.score >= minScore).slice(0, opts.autoDraftTop ?? 5);

    if (draftable.length && llmReady()) {
      for (const [i, lead] of draftable.entries()) {
        await progress("draft", `Drafting for ${lead.companyName} (${i + 1}/${draftable.length})`, 75 + Math.round((i / draftable.length) * 15));
        try {
          // eslint-disable-next-line no-await-in-loop
          const { subject, body } = await generateOutreachDraft({ channel: "email", lead });
          lead.draft = { channel: "email", subject, body };
          stats.drafted += 1;
        } catch (err) {
          console.error(`[worker] draft failed for ${lead.companyName}: ${err.message}`);
        }
      }
    } else if (draftable.length) {
      console.warn("[worker] no model reachable — delivering leads without drafts");
    }

    // --- 7. Deliver --------------------------------------------------------
    await progress("draft", `Delivering ${deliverable.length} verified leads…`, 92);
    for (let i = 0; i < deliverable.length; i += DELIVER_BATCH) {
      const batch = deliverable.slice(i, i + DELIVER_BATCH);
      // eslint-disable-next-line no-await-in-loop
      const delivered = await deliverLeads(runId, batch);
      stats.created += delivered.created;
      stats.duplicates += delivered.duplicates;
      stats.hot += delivered.hot;
    }

    const aiSummary = llmReady() ? await summarizeBatch(deliverable.filter((l) => l.score >= minScore)) : null;
    const summary = [
      `${candidates.length} companies checked → ${stats.verified} verified → ${deliverable.length} delivered.`,
      stats.rejected ? `Rejected: ${formatRejections(rejections)}.` : "",
      aiSummary || "",
    ].filter(Boolean).join(" ");
    await finishRun(runId, {
      status: "done",
      summary,
      sourceResults,
      stats: { discovered: stats.discovered, resolved: stats.resolved, enriched: stats.enriched, scored: stats.scored, verified: stats.verified, rejected: stats.rejected },
    });
    return stats;
  } catch (err) {
    console.error("[worker] run failed:", err.message);
    await finishRun(runId, { status: "failed", error: err.message, sourceResults, stats }).catch(() => {});
    throw err;
  }
}

export function formatRejections(rejections) {
  return Object.entries(rejections)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`)
    .join(", ");
}

// The Admin page's deep scan: one domain, full browser fallback. Much shorter
// than a discovery run, which is why the server hands these out first.
export async function runDeepScanJob(job) {
  try {
    const result = await scrapeCompanyContactTiered(job.domain);
    await finishScan(job.id, {
      emails: result.emails,
      pagesOk: result.pagesOk,
      pagesTried: result.pagesTried,
      tier: result.tier,
    });
    return result;
  } catch (err) {
    await finishScan(job.id, { emails: [], error: err.message }).catch(() => {});
    throw err;
  }
}
