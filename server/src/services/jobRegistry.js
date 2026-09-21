import { checkForReplies } from "./inboxService.js";
import { runFollowUpCheck } from "./followUpService.js";
import { generateWeeklyDigest, shouldRunWeeklyDigest } from "./digestService.js";
import { runScheduledPipeline } from "./pipelineService.js";

// One declared list of every recurring job, with its schedule and its last
// outcome. Previously these were loose setInterval calls in index.js, which
// meant the only way to find out whether a job had ever run — or why it had
// stopped running — was to read the server log. Now the registry is the
// source of truth and GET /api/admin/jobs reports it.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const JOBS = [
  {
    key: "replyCheck",
    label: "Reply check (IMAP)",
    everyMs: 5 * MIN,
    runAtBootAfterMs: 15 * 1000,
    run: checkForReplies,
  },
  {
    key: "followUp",
    label: "Follow-up nudges",
    everyMs: 6 * HOUR,
    run: runFollowUpCheck,
  },
  {
    key: "weeklyDigest",
    label: "Weekly digest",
    everyMs: 12 * HOUR,
    // Checked twice a day but only actually generated once a week; the guard
    // lives with the job rather than in the scheduler.
    shouldRun: shouldRunWeeklyDigest,
    run: generateWeeklyDigest,
  },
  {
    key: "leadPipeline",
    label: "Lead discovery pipeline",
    everyMs: Number(process.env.PIPELINE_EVERY_HOURS || 24) * HOUR,
    // Off unless explicitly enabled: an unattended crawler that starts itself
    // the first time you run `npm run dev` is not a good default.
    enabled: () => process.env.PIPELINE_SCHEDULE_ENABLED === "true",
    run: runScheduledPipeline,
  },
];

const state = new Map(
  JOBS.map((j) => [j.key, { key: j.key, label: j.label, everyMs: j.everyMs, lastRunAt: null, lastOk: null, lastError: null, lastResult: null, runs: 0 }])
);

export function jobStatus() {
  return JOBS.map((job) => ({
    ...state.get(job.key),
    enabled: job.enabled ? job.enabled() : true,
  }));
}

async function tick(job) {
  if (job.enabled && !job.enabled()) return;
  const s = state.get(job.key);
  try {
    if (job.shouldRun && !(await job.shouldRun())) return;
    const result = await job.run();
    s.lastOk = true;
    s.lastError = null;
    s.lastResult = result ?? null;
  } catch (err) {
    s.lastOk = false;
    s.lastError = err.message;
    console.error(`[jobs] ${job.key} failed:`, err.message);
  } finally {
    s.lastRunAt = new Date();
    s.runs += 1;
  }
}

export function startBackgroundJobs() {
  for (const job of JOBS) {
    setInterval(() => tick(job), job.everyMs).unref();
    if (job.runAtBootAfterMs) setTimeout(() => tick(job), job.runAtBootAfterMs).unref();
  }
  const on = JOBS.filter((j) => !j.enabled || j.enabled()).map((j) => j.key);
  console.log(`[jobs] started: ${on.join(", ")}`);
}

export async function runJobNow(key) {
  const job = JOBS.find((j) => j.key === key);
  if (!job) throw new Error(`Unknown job "${key}"`);
  await tick(job);
  return state.get(key);
}
