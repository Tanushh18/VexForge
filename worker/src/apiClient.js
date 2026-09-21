import axios from "axios";

// Talks to the deployed VexForge API. The worker authenticates with a shared
// key rather than the CEO login — it runs unattended on a machine that
// shouldn't hold your password, and a key can be rotated independently.

const API_URL = (process.env.VEXFORGE_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const WORKER_API_KEY = process.env.WORKER_API_KEY || "";
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

export const config = { apiUrl: API_URL, workerId: WORKER_ID };

if (!WORKER_API_KEY) {
  console.error("[worker] WORKER_API_KEY is not set — copy .env.example to .env and fill it in.");
  process.exit(1);
}

const http = axios.create({
  baseURL: `${API_URL}/api/pipeline`,
  timeout: 30000,
  headers: { "x-worker-key": WORKER_API_KEY, "x-worker-id": WORKER_ID },
});

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
