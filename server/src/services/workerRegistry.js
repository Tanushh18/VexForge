// Tracks which local workers have checked in recently, so the UI can tell
// "no worker is running" apart from "a worker is running but found nothing".
// Without this, a laptop that's asleep looks identical to a quiet night.
//
// Deliberately in-memory: a worker that last polled before the server
// restarted tells you nothing useful, and it re-registers within one poll
// interval anyway.

const workers = new Map();

// Two missed polls (the worker polls every 15s by default) before we call it
// gone — one slow request shouldn't flip the badge to offline.
const STALE_AFTER_MS = Number(process.env.WORKER_STALE_AFTER_MS || 45000);

export function recordWorkerSeen(workerId, detail = {}) {
  workers.set(workerId, { workerId, lastSeenAt: new Date(), ...detail });
}

export function workerStatus() {
  const now = Date.now();
  const all = [...workers.values()].map((w) => ({
    ...w,
    online: now - w.lastSeenAt.getTime() < STALE_AFTER_MS,
  }));
  return {
    workers: all.sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    anyOnline: all.some((w) => w.online),
    staleAfterMs: STALE_AFTER_MS,
  };
}
