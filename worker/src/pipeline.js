import { discoverLeads } from "./leadSources/index.js";
import { scrapeCompanyContactTiered } from "./scraper.js";
import { scoreLead, scoreLeadWithModel, summarizeBatch } from "../../shared/scoring.js";
import { generateOutreachDraft } from "../../shared/outreach.js";
import { llmReady, refreshModelHealth } from "../../shared/modelRouter.js";
import { reportProgress, deliverLeads, finishRun, finishScan } from "./apiClient.js";

// The end-to-end run, executed here rather than on the server because every
// stage below either drives Chromium or needs a local model:
//
//   1. discover  public listing sites (Product Hunt, HN launches, YC)
//   2. enrich    a contact email from the company's OWN site
//   3. score     deterministic signals, then the local reasoning model
//   4. draft     outreach for the top N — Ollama is on localhost here, which
//                is why drafting can't silently go missing the way it would
//                if the server had to reach a model across a tunnel
//   5. deliver   POST to the deployed API, which owns dedupe and storage
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
  const stats = { discovered: 0, duplicates: 0, created: 0, enriched: 0, scored: 0, drafted: 0, hot: 0 };
  let sourceResults = [];

  const progress = (stage, note, percent) => reportProgress(runId, { stage, note, percent, stats, sourceResults });

  try {
    await refreshModelHealth();

    // --- 1. Discover -------------------------------------------------------
    await progress("discover", `Crawling ${(opts.sources || []).length} source(s)…`, 5);
    const results = await discoverLeads({ sources: opts.sources, perSource: opts.perSource });
    sourceResults = results.map(({ source, ok, found, error }) => ({ source, ok, found, error }));

    const candidates = results.flatMap((r) => r.leads.map((l) => ({ ...l, discoverySource: r.source })));
    stats.discovered = candidates.length;
    await progress("discover", `Found ${candidates.length} companies`, 25);

    if (!candidates.length) {
      await finishRun(runId, { status: "done", summary: "No companies found — the sources returned nothing.", sourceResults, stats });
      return stats;
    }

    // --- 2. Enrich ---------------------------------------------------------
    // Sequential and unhurried on purpose: this visits each company's own site
    // one at a time, which is the politeness contract the scraper is built on.
    if (opts.enrich !== false) {
      for (const [i, lead] of candidates.entries()) {
        if (!lead.website || lead.contactEmail) continue;
        await progress("enrich", `Looking for an email — ${lead.companyName} (${i + 1}/${candidates.length})`, 25 + Math.round((i / candidates.length) * 30));
        try {
          // eslint-disable-next-line no-await-in-loop
          const found = await scrapeCompanyContactTiered(lead.website);
          if (found.emails.length) {
            lead.contactEmail = found.emails[0];
            lead.sourceNote = `Discovered via ${lead.discoverySource} · email found on ${found.pagesOk[0] || found.website}`;
            stats.enriched += 1;
          } else {
            lead.sourceNote = `Discovered via ${lead.discoverySource} · no public email found`;
          }
        } catch (err) {
          console.error(`[worker] enrich failed for ${lead.companyName}: ${err.message}`);
        }
      }
    }

    // --- Mandatory contact filter -------------------------------------------
    // A lead with no email survived discovery and a full enrichment pass
    // (static, then Playwright) with nothing to reach it by — it never
    // becomes a prospect, so it never reaches the CRM. This also removes
    // funding-news leads outright: that source carries no `website` at all
    // (a headline can't reliably say which domain is really the company's),
    // so enrichment never runs on them and they're dropped here by design.
    const { withContact, dropped } = partitionByContact(candidates);
    if (dropped.length) {
      await progress("enrich", `Dropping ${dropped.length} lead(s) with no reachable contact`, 54);
    }

    if (!withContact.length) {
      await finishRun(runId, {
        status: "done",
        summary: `Found ${candidates.length} companies, but none had a reachable contact email after enrichment.`,
        sourceResults,
        stats: { discovered: stats.discovered, enriched: stats.enriched, scored: 0 },
      });
      return stats;
    }

    // --- 3. Score ----------------------------------------------------------
    const useModel = opts.useModelScoring !== false && llmReady();
    for (const [i, lead] of withContact.entries()) {
      await progress("score", `Scoring ${lead.companyName} (${i + 1}/${withContact.length})`, 55 + Math.round((i / withContact.length) * 20));
      // eslint-disable-next-line no-await-in-loop
      const scored = useModel ? await scoreLeadWithModel(lead) : scoreLead(lead);
      Object.assign(lead, scored);
      stats.scored += 1;
    }

    // --- 4. Draft the top slice -------------------------------------------
    // Only leads that clear the score floor AND have somewhere to send to.
    // Drafting for a lead with no email just fills the queue with messages
    // that can never be sent.
    const minScore = opts.minDraftScore ?? 60;
    const draftable = withContact
      .filter((l) => l.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.autoDraftTop ?? 5);

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
      console.warn("[worker] no local model reachable — delivering leads without drafts");
    }

    // --- 5. Deliver --------------------------------------------------------
    await progress("draft", `Delivering ${withContact.length} leads…`, 92);
    for (let i = 0; i < withContact.length; i += DELIVER_BATCH) {
      const batch = withContact.slice(i, i + DELIVER_BATCH);
      // eslint-disable-next-line no-await-in-loop
      const delivered = await deliverLeads(runId, batch);
      stats.created += delivered.created;
      stats.duplicates += delivered.duplicates;
      stats.hot += delivered.hot;
    }

    const summary = await summarizeBatch(withContact.filter((l) => l.score >= minScore));
    // The server has been counting created/duplicates/drafted as each batch
    // landed, so only the counters it can't see are sent here.
    await finishRun(runId, {
      status: "done",
      summary,
      sourceResults,
      stats: { discovered: stats.discovered, enriched: stats.enriched, scored: stats.scored },
    });
    return stats;
  } catch (err) {
    console.error("[worker] run failed:", err.message);
    await finishRun(runId, { status: "failed", error: err.message, sourceResults, stats }).catch(() => {});
    throw err;
  }
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
