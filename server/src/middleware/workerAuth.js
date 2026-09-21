import crypto from "node:crypto";

// The local worker authenticates with a shared key rather than the CEO login.
// Two reasons: the worker runs unattended on a machine that shouldn't hold
// your password, and a key can be rotated without changing how you sign in.
//
// Worker endpoints are deliberately narrow — claim a job, report progress,
// submit leads. The key cannot read the CRM or touch the send path.

const WORKER_API_KEY = process.env.WORKER_API_KEY || "";

export function workerAuthConfigured() {
  return WORKER_API_KEY.length >= 16;
}

// Constant-time compare: a plain `===` on a secret leaks its prefix through
// timing, and this endpoint is reachable from the public internet.
function keyMatches(presented) {
  const a = Buffer.from(presented);
  const b = Buffer.from(WORKER_API_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function requireWorker(req, res, next) {
  if (!workerAuthConfigured()) {
    // Fail closed. An unset key must not mean "let anyone post leads" — these
    // endpoints write to the CRM.
    return res.status(503).json({ error: "Worker API is disabled — set WORKER_API_KEY (32+ chars) on the server" });
  }
  const presented = req.get("x-worker-key") || "";
  if (!presented || !keyMatches(presented)) {
    return res.status(401).json({ error: "Invalid or missing worker key" });
  }
  req.workerId = req.get("x-worker-id") || "unknown-worker";
  next();
}
