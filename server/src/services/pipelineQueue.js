import PipelineRun from "../models/PipelineRun.js";
import { getSettings, updateSettings } from "../models/Settings.js";
import { triggerWorkflow, githubTriggerConfigured } from "./githubTrigger.js";
import { workerStatus } from "./workerRegistry.js";

// Queueing a pipeline run, shared by the console's "Start run" button and the
// scheduled job. The server never executes a run — Chromium lives on the
// local worker — so both paths do the same small thing: create a ticket and
// let the worker claim it.

// The discovery sources live on the worker, so the server can't introspect
// them. This list populates the UI's checkboxes and validates what gets
// queued; adding a source means updating this list and the worker together.
// Order matters here: it's kept in the same direct-fetch/Playwright
// interleaving as worker/src/leadSources/index.js, so a contiguous rotation
// slice (see pickRotationBatch below) naturally samples both kinds rather
// than exhausting the direct-fetch sources before ever reaching a browser
// one, or vice versa.
export const SOURCE_CATALOGUE = [
  { key: "hn_launches", label: "Hacker News launches", needsBrowser: false },
  { key: "product_hunt", label: "Product Hunt launches", needsBrowser: true },
  { key: "reddit_launches", label: "Reddit launches (r/startups, r/SaaS)", needsBrowser: false },
  { key: "yc_directory", label: "Y Combinator directory (funded + hiring)", needsBrowser: true },
  { key: "funding_news", label: "Funding news — India (Google News); website found by name", needsBrowser: false },
  { key: "betalist", label: "BetaList — startups launching", needsBrowser: true },
  { key: "show_hn", label: "Show HN — products just shipped (with traction)", needsBrowser: false },
  { key: "betapage", label: "BetaPage — startup launches", needsBrowser: true },
  { key: "hn_hiring", label: "HN Who's Hiring — startups hiring engineers now", needsBrowser: false },
  { key: "indiehackers_products", label: "Indie Hackers — products", needsBrowser: true },
  { key: "funding_news_global", label: "Funding news — global (Google News, US edition)", needsBrowser: false },
  { key: "saashub", label: "SaaSHub — newest SaaS tools", needsBrowser: true },
  { key: "f6s", label: "F6S — startup directory", needsBrowser: true },
  { key: "startupranking", label: "StartupRanking — newest startups", needsBrowser: true },
  { key: "launchingnext", label: "Launching Next — new startups", needsBrowser: true },
  { key: "devhunt", label: "DevHunt — developer tool launches", needsBrowser: true },
  { key: "peerlist_launches", label: "Peerlist — project launches", needsBrowser: true },
  { key: "wellfound_startups", label: "Wellfound — startup listings", needsBrowser: true },
  { key: "libhunt", label: "LibHunt — trending open-source projects", needsBrowser: true },
  { key: "openalternative", label: "OpenAlternative — new open-source tools", needsBrowser: true },
  { key: "alternativeto_new", label: "AlternativeTo — recently added", needsBrowser: true },
  { key: "uneed", label: "Uneed — new tools launching", needsBrowser: true },
  { key: "microlaunch", label: "Microlaunch — micro-SaaS launches", needsBrowser: true },
];

export const DEFAULTS = {
  perSource: Number(process.env.PIPELINE_PER_SOURCE || 12),
  enrich: true,
  // Scoring is deterministic from verified facts; the model pass is opt-in.
  useModelScoring: process.env.PIPELINE_MODEL_SCORING === "true",
  minDeliverScore: Number(process.env.PIPELINE_MIN_DELIVER_SCORE || 45),
  autoDraftTop: Number(process.env.PIPELINE_AUTO_DRAFT_TOP || 5),
  minDraftScore: Number(process.env.PIPELINE_MIN_DRAFT_SCORE || 60),
};

// 23 sources is a lot to walk in one run — sequentially, on purpose, since a
// polite crawler doesn't hit a handful of sites in parallel from one IP. A
// batch of 8 keeps a single run's wall-clock time reasonable; the cursor
// below advances each run so every source gets covered roughly every
// ceil(23/8) = 3 runs, rather than either hammering all 20 every time or
// requiring you to hand-pick a subset yourself.
export const ROTATION_BATCH_SIZE = Number(process.env.PIPELINE_ROTATION_BATCH_SIZE || 8);

export const ACTIVE_STATUSES = ["queued", "claimed", "running"];

export function findActiveRun() {
  return PipelineRun.findOne({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: 1 });
}

// Pure and independently testable: given the full key list and a cursor
// position, returns the next contiguous (wrapping) slice. Kept outside any
// I/O so the wraparound and interleaving logic can be checked without a
// database.
export function pickRotationBatch(keys, cursor, batchSize) {
  if (!keys.length) return { batch: [], nextCursor: 0 };
  const size = Math.min(Math.max(1, batchSize), keys.length);
  const start = ((cursor % keys.length) + keys.length) % keys.length; // safe for a negative or stale cursor
  const batch = [];
  for (let i = 0; i < size; i++) batch.push(keys[(start + i) % keys.length]);
  return { batch, nextCursor: (start + size) % keys.length };
}

// Reads the persisted rotation cursor, advances it, and returns this run's
// batch. Used only when the caller didn't explicitly choose sources — an
// explicit choice (the console's checkboxes, or an API caller passing
// `sources`) always wins and is never overridden by rotation.
async function nextRotationBatch() {
  const keys = SOURCE_CATALOGUE.map((s) => s.key);
  const { rotationCursor = 0 } = await getSettings();
  const { batch, nextCursor } = pickRotationBatch(keys, rotationCursor, ROTATION_BATCH_SIZE);
  await updateSettings({ rotationCursor: nextCursor });
  return batch;
}

export function validSources(requested) {
  const valid = new Set(SOURCE_CATALOGUE.map((s) => s.key));
  return requested.filter((s) => valid.has(s));
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

  // Presence of a non-empty `sources` array is what makes a choice explicit.
  // Anything else — omitted, undefined, an empty array — means "you decide",
  // which is what the rotation cursor is for.
  const explicit = Array.isArray(options.sources) && options.sources.length > 0;
  const sources = explicit ? validSources(options.sources) : await nextRotationBatch();

  if (!sources.length) {
    const err = new Error(
      explicit ? "None of the requested sources are valid" : "No sources available to rotate through"
    );
    err.statusCode = 400;
    throw err;
  }

  const run = await PipelineRun.create({
    kind: "discovery",
    status: "queued",
    stage: "queued",
    trigger,
    options: { ...DEFAULTS, ...options, sources },
  });

  // Wake the GitHub Actions worker rather than leaving this job to wait for
  // the workflow's own daily cron. Skipped if a local worker already polled
  // recently — its atomic job-claim makes a redundant Actions run harmless,
  // but there's no reason to spend Actions minutes on one when a machine is
  // already right here checking every 15s. Fire-and-forget: this never
  // blocks or fails the enqueue, since the job is valid and queued either way.
  if (githubTriggerConfigured() && !workerStatus().anyOnline) {
    triggerWorkflow().catch(() => {}); // triggerWorkflow itself never rejects; belt and suspenders
  }

  return run;
}

// The scheduled entry point. Skips rather than stacking if something is
// already queued — including a run queued hours ago that no worker ever came
// online to claim. Never passes explicit sources, so every scheduled run
// rotates automatically.
export async function enqueueScheduledRun() {
  const active = await findActiveRun();
  if (active) return { skipped: "a run is already queued or in progress", runId: active._id };
  const run = await enqueueRun({}, "scheduled");
  return { runId: run._id };
}
