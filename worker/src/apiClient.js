import axios from "axios";

// Talks to the deployed VexForge API. The worker authenticates with a shared
// key rather than the CEO login — it runs unattended on a machine that
// shouldn't hold your password, and a key can be rotated independently.

const WORKER_API_KEY = process.env.WORKER_API_KEY || "";
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

export const config = { workerId: WORKER_ID };

// Checked here rather than exiting at import time: a process.exit() as a
// module-load side effect means anything that imports this module — a test,
// a future script that only needs config — takes the whole process down with
// it. index.js calls this once, deliberately, right before starting the loop.
export function assertConfigured() {
  if (!WORKER_API_KEY) {
    console.error("[worker] WORKER_API_KEY is not set — copy .env.example to .env and fill it in.");
    process.exit(1);
  }
}

// The API address comes only from Stashr (project "vexforge" Server URLs): no VEXFORGE_API_URL, no fallback. Switched
// off or never reached means calls fail at once, and the last answer Stashr gave is kept while it is unreachable.
const NO_SERVER = "https://stashr-no-server.invalid";
let stashr = { url: "", at: 0, known: false };
async function currentApiUrl() {
  if (stashr.known && Date.now() - stashr.at < 5 * 60 * 1000) return stashr.url || NO_SERVER;
  try {
    const res = await fetch("https://password-manager-server-xxdr.onrender.com/registry/vexforge", { signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const url = String(((await res.json()).urls || [])[0] || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
      stashr = { url: /^https?:\/\//i.test(url) ? url : "", at: Date.now(), known: true };
    }
  } catch { /* keep the last answer */ }
  return stashr.url || NO_SERVER;
}

const http = axios.create({
  baseURL: `${NO_SERVER}/api/pipeline`,
  timeout: 30000,
  headers: { "x-worker-key": WORKER_API_KEY, "x-worker-id": WORKER_ID },
});

http.interceptors.request.use(async (req) => { req.baseURL = `${await currentApiUrl()}/api/pipeline`; return req; });

// The API may be a home tunnel or a spun-down instance, so a failed call is
// normal rather than exceptional. Callers get a thrown error with a readable
// message instead of an axios object twelve levels deep.
function unwrap(err, what) {
  const detail = err.response?.data?.error || err.message;
  const status = err.response?.status;
  return new Error(`${what} failed${status ? ` (${status})` : ""}: ${detail}`);
}

export async function pollForJob() {
  try {
    const { data } = await http.post("/worker/poll", { version: 1, capabilities: ["discovery", "deep_scan"] });
    return data.job || null;
  } catch (err) {
    throw unwrap(err, "Poll");
  }
}

export async function reportProgress(runId, progress) {
  try {
    await http.post(`/worker/runs/${runId}/progress`, progress);
  } catch (err) {
    // Progress is cosmetic — losing an update must not abort a run that's
    // otherwise working.
    console.warn(`[worker] progress update dropped: ${unwrap(err, "Progress").message}`);
  }
}

export async function deliverLeads(runId, leads) {
  try {
    const { data } = await http.post(`/worker/runs/${runId}/leads`, { leads });
    return data;
  } catch (err) {
    throw unwrap(err, "Lead delivery");
  }
}

export async function finishRun(runId, payload) {
  try {
    const { data } = await http.post(`/worker/runs/${runId}/finish`, payload);
    return data;
  } catch (err) {
    throw unwrap(err, "Finish");
  }
}

export async function finishScan(scanId, payload) {
  try {
    const { data } = await http.post(`/worker/scans/${scanId}/finish`, payload);
    return data;
  } catch (err) {
    throw unwrap(err, "Scan finish");
  }
}
