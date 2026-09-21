import PipelineRun from "../models/PipelineRun.js";

// Queueing a pipeline run, shared by the console's "Start run" button and the
// scheduled job. The server never executes a run — Chromium lives on the
// local worker — so both paths do the same small thing: create a ticket and
// let the worker claim it.

// The discovery sources live on the worker, so the server can't introspect
// them. This list populates the UI's checkboxes and validates what gets
// queued; adding a source means updating this list and the worker together.
export const SOURCE_CATALOGUE = [
  { key: "hn_launches", label: "Hacker News launches", needsBrowser: false },
  { key: "product_hunt", label: "Product Hunt launches", needsBrowser: true },
  { key: "yc_directory", label: "Y Combinator directory (funded + hiring)", needsBrowser: true },
];

export const DEFAULTS = {
  perSource: Number(process.env.PIPELINE_PER_SOURCE || 12),
  enrich: true,
  useModelScoring: true,
  autoDraftTop: Number(process.env.PIPELINE_AUTO_DRAFT_TOP || 5),
  minDraftScore: Number(process.env.PIPELINE_MIN_DRAFT_SCORE || 60),
};

export const ACTIVE_STATUSES = ["queued", "claimed", "running"];

export function findActiveRun() {
  return PipelineRun.findOne({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: 1 });
}

export function validSources(requested) {
  const valid = SOURCE_CATALOGUE.map((s) => s.key);
  const list = Array.isArray(requested) && requested.length ? requested : valid;
  return list.filter((s) => valid.includes(s));
}

// One run at a time, enforced here rather than in the worker: two runs would
// crawl the same listing pages twice and race each other on dedupe.
export async function enqueueRun(options = {}, trigger = "manual") {
  const active = await findActiveRun();
  if (active) {
    const err = new Error("A pipeline run is already queued or in progress");
    err.statusCode = 409;
    err.runId = active._id;
    throw err;
  }

  const sources = validSources(options.sources);
  if (!sources.length) {
    const err = new Error("No valid sources selected");
    err.statusCode = 400;
    throw err;
  }

  return PipelineRun.create({
    kind: "discovery",
    status: "queued",
    stage: "queued",
    trigger,
    options: { ...DEFAULTS, ...options, sources },
  });
}

// The scheduled entry point. Skips rather than stacking if something is
// already queued — including a run queued hours ago that no worker ever came
// online to claim.
export async function enqueueScheduledRun() {
  const active = await findActiveRun();
  if (active) return { skipped: "a run is already queued or in progress", runId: active._id };
  const run = await enqueueRun({}, "scheduled");
  return { runId: run._id };
}
