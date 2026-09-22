import "dotenv/config";
import { pollForJob, config, assertConfigured } from "./apiClient.js";
import { runDiscoveryJob, runDeepScanJob } from "./pipeline.js";
import { refreshModelHealth, modelStatus } from "../../shared/modelRouter.js";

// The local worker. Polls the deployed API for queued jobs, runs them here
// where Chromium runs, and posts results back. Scoring/drafting calls out to
// Groq's hosted API (see shared/modelRouter.js) rather than a local model.
//
//   npm start        poll forever (what you leave running, or put in cron)
//   npm run once     take at most one job, then exit — good for a cron entry
//                    that you'd rather not leave resident

const POLL_MS = Number(process.env.WORKER_POLL_MS || 15000);
const ONCE = process.argv.includes("--once");

let stopping = false;

async function handle(job) {
  const started = Date.now();
  console.log(`[worker] claimed ${job.kind} job ${job.id}`);
  try {
    if (job.kind === "deep_scan") {
      const r = await runDeepScanJob(job);
      console.log(`[worker] deep scan done — ${r.emails.length} email(s) via ${r.tier} tier`);
    } else {
      const s = await runDiscoveryJob(job);
      console.log(`[worker] run done — ${s.created} new, ${s.duplicates} dup, ${s.enriched} enriched, ${s.drafted} drafted`);
    }
  } catch (err) {
    // The job is already marked failed server-side by the pipeline's own
    // error path; this loop just keeps going.
    console.error(`[worker] job ${job.id} failed: ${err.message}`);
  }
  console.log(`[worker] took ${Math.round((Date.now() - started) / 1000)}s`);
}

async function loop() {
  assertConfigured();

  // Report what's actually available once at startup, since "the worker is
  // running but every draft is empty" is otherwise a confusing way to find
  // out GROQ_API_KEYS was never set.
  await refreshModelHealth();
  const models = modelStatus();
  console.log(`[worker] ${config.workerId} → ${config.apiUrl}`);
  console.log(
    models.backend
      ? `[worker] models via ${models.backend} (${models.keyCount} key(s)): ${models.roles.map((r) => `${r.role}→${r.model}`).join(", ")}`
      : "[worker] no Groq API key configured (GROQ_API_KEYS) — runs will score deterministically and skip drafting"
  );

  // A poll failure is expected now and then (tunnel down, instance asleep), so
  // back off rather than hammering, and never exit the loop over it.
  let consecutiveFailures = 0;

  while (!stopping) {
    let job = null;
    try {
      job = await pollForJob();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      const backoff = Math.min(POLL_MS * 2 ** Math.min(consecutiveFailures, 4), 5 * 60 * 1000);
      console.error(`[worker] ${err.message} — retrying in ${Math.round(backoff / 1000)}s`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoff);
      continue;
    }

    if (job) {
      // eslint-disable-next-line no-await-in-loop
      await handle(job);
      if (ONCE) return;
      continue; // check immediately — there may be more queued
    }

    if (ONCE) {
      console.log("[worker] nothing queued");
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_MS);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Finish the job in flight rather than leaving it claimed-but-abandoned,
// which would otherwise block the next run until it was cleared by hand.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (stopping) process.exit(1); // second Ctrl-C means "now"
    stopping = true;
    console.log("\n[worker] finishing current job, then stopping — Ctrl-C again to force");
  });
}

loop()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
