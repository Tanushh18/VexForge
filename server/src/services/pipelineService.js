import Lead from "../models/Lead.js";
import PipelineRun from "../models/PipelineRun.js";
import OutreachMessage from "../models/OutreachMessage.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { discoverLeads } from "./leadSources/index.js";
import { findDuplicateLead } from "./leadRepository.js";
import { scrapeCompanyContactTiered } from "./scraperService.js";
import { scoreLead, scoreLeadWithModel, summarizeBatch } from "./scoringService.js";
import { generateOutreachDraft } from "./llmService.js";
import { notify } from "./notifyService.js";

// The end-to-end lead pipeline, in one place:
//
//   1. discover  — public listing sites (Product Hunt, HN launches, YC)
//   2. dedupe    — against the existing CRM, by company name or domain
//   3. enrich    — find a contact email on the company's OWN site
//   4. score     — deterministic signals, then the local reasoning model
//   5. draft     — queue outreach for the top N scoring leads only
//
// Step 5 stops at `draft`. Nothing in this file can send anything: the
// approval gate in routes/outreach.js and the daily cap in sendQuotaService
// are both downstream of it, by design. A fully automatic pipeline that also
// sends is one bad scoring pass away from emailing a hundred wrong people.

export const DEFAULTS = {
  perSource: Number(process.env.PIPELINE_PER_SOURCE || 12),
  enrich: true,
  useModelScoring: true,
  autoDraftTop: Number(process.env.PIPELINE_AUTO_DRAFT_TOP || 5),
  minDraftScore: Number(process.env.PIPELINE_MIN_DRAFT_SCORE || 60),
};

async function agentByTitle(fragment) {
  return Employee.findOne({ title: new RegExp(fragment, "i") });
}

let running = false;
export function pipelineIsRunning() {
  return running;
}

export async function startPipelineRun(options = {}, trigger = "manual") {
  // The run walks external sites with a shared browser and writes to the CRM;
  // two concurrent runs would duplicate both the crawl and the leads.
  if (running) {
    const err = new Error("A pipeline run is already in progress");
    err.statusCode = 409;
    throw err;
  }
  const opts = { ...DEFAULTS, ...options };
  const run = await PipelineRun.create({ status: "queued", trigger, options: opts });
  executeRun(run._id, opts).catch((err) => console.error(`[pipeline ${run._id}] unhandled:`, err));
  return run;
}

async function executeRun(runId, opts) {
  running = true;
  const run = await PipelineRun.findById(runId);
  const scout = await agentByTitle("Lead Scout");
  const ranker = await agentByTitle("Lead Ranker");
  const drafter = await agentByTitle("Outreach Drafter");

  run.status = "running";
  run.startedAt = new Date();
  await run.save();

  try {
    // --- 1. Discover -------------------------------------------------------
    if (scout) await setAgentStatus(scout._id, { status: "working", currentTask: `Scanning ${opts.sources?.length || "all"} lead sources` });
    const sourceResults = await discoverLeads({ sources: opts.sources, perSource: opts.perSource });
    run.sourceResults = sourceResults.map(({ source, ok, found, error }) => ({ source, ok, found, error }));

    const discovered = sourceResults.flatMap((r) => r.leads.map((l) => ({ ...l, discoverySource: r.source })));
    run.stats.discovered = discovered.length;
    await run.save();

    // --- 2. Dedupe + create ------------------------------------------------
    const created = [];
    for (const candidate of discovered) {
      // eslint-disable-next-line no-await-in-loop
      const duplicate = await findDuplicateLead(candidate);
      if (duplicate) {
        run.stats.duplicates += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const lead = await Lead.create({
        companyName: candidate.companyName,
        website: candidate.website,
        notes: candidate.notes,
        signals: candidate.signals,
        source: "discovery",
        discoverySource: candidate.discoverySource,
        sourceUrl: candidate.sourceUrl,
        discoveredAt: candidate.discoveredAt || new Date(),
        sourceNote: `Discovered via ${candidate.discoverySource}`,
        ...scoreLead(candidate),
        scoredAt: new Date(),
      });
      created.push(lead);
      run.stats.created += 1;
    }
    await run.save();
    if (scout) await setAgentStatus(scout._id, { status: "idle", currentTask: `Found ${created.length} new companies`, bumpCompleted: true });

    // --- 3. Enrich ---------------------------------------------------------
    // Sequential and untimed on purpose — this visits each company's own site
    // one at a time, which is the politeness contract the scraper is built on.
    if (opts.enrich) {
      for (const lead of created) {
        if (!lead.website || lead.contactEmail) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await scrapeCompanyContactTiered(lead.website);
          if (!result.emails.length) continue;
          lead.contactEmail = result.emails[0];
          lead.sourceNote = `${lead.sourceNote} · email found on ${result.pagesOk[0] || result.website}`;
          // eslint-disable-next-line no-await-in-loop
          await lead.save();
          run.stats.enriched += 1;
        } catch (err) {
          console.error(`[pipeline] enrich failed for ${lead.companyName}:`, err.message);
        }
      }
      await run.save();
    }

    // --- 4. Score ----------------------------------------------------------
    if (ranker) await setAgentStatus(ranker._id, { status: "working", currentTask: `Scoring ${created.length} leads` });
    for (const lead of created) {
      // eslint-disable-next-line no-await-in-loop
      const scored = opts.useModelScoring ? await scoreLeadWithModel(lead.toObject()) : scoreLead(lead.toObject());
      Object.assign(lead, scored, { scoredAt: new Date() });
      // eslint-disable-next-line no-await-in-loop
      await lead.save();
      run.stats.scored += 1;
      if (lead.scoreBand === "hot") run.stats.hot += 1;
    }
    await run.save();
    if (ranker) await setAgentStatus(ranker._id, { status: "idle", currentTask: `Ranked ${created.length} leads`, bumpCompleted: true });

    // --- 5. Draft the top slice -------------------------------------------
    // Only leads that clear the score floor AND have somewhere to send to.
    // Drafting for a lead with no email just fills the queue with messages
    // that can never be sent.
    const draftable = created
      .filter((l) => l.contactEmail && l.score >= opts.minDraftScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.autoDraftTop);

    for (const lead of draftable) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { subject, body } = await generateOutreachDraft({ channel: "email", lead });
        // eslint-disable-next-line no-await-in-loop
        const msg = await OutreachMessage.create({
          lead: lead._id,
          channel: "email",
          subject,
          body,
          status: "draft",
          draftedBy: drafter?._id,
        });
        lead.stage = "outreach_drafted";
        // eslint-disable-next-line no-await-in-loop
        await lead.save();
        run.stats.drafted += 1;
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
      } catch (err) {
        console.error(`[pipeline] draft failed for ${lead.companyName}:`, err.message);
      }
    }

    run.summary = await summarizeBatch(created.map((l) => l.toObject()));
    run.status = "done";
    run.finishedAt = new Date();
    await run.save();

    await logActivity({
      actorName: "Pipeline",
      department: "Operations",
      action: "Lead pipeline run finished",
      detail: `${run.stats.created} new · ${run.stats.enriched} enriched · ${run.stats.hot} hot · ${run.stats.drafted} drafted`,
      entityType: "PipelineRun",
      entityId: run._id,
    });
    if (run.stats.created) {
      await notify(
        `🎯 Pipeline run done — *${run.stats.created}* new leads (${run.stats.hot} hot), ${run.stats.drafted} draft(s) awaiting your approval.`
      );
    }
  } catch (err) {
    run.status = "failed";
    run.error = err.message;
    run.finishedAt = new Date();
    await run.save();
    await logActivity({ actorName: "Pipeline", department: "Operations", action: "Lead pipeline run failed", detail: err.message });
  } finally {
    running = false;
    if (scout) await setAgentStatus(scout._id, { status: "idle", currentTask: "Standing by" });
  }

  return run;
}

// The scheduled entry point. Skips itself if a manual run is already going,
// rather than queueing a second crawl behind it.
export async function runScheduledPipeline() {
  if (running) return { skipped: "already running" };
  const run = await startPipelineRun({}, "scheduled");
  return { runId: run._id };
}
