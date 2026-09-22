// Wakes the GitHub Actions worker the moment a run is queued, instead of
// leaving it to wait for the workflow's own daily cron or a manual click in
// the Actions tab. Uses GitHub's REST API to fire workflow_dispatch on
// pipeline.yml — the same effect as clicking "Run workflow" yourself.
//
// GITHUB_TRIGGER_TOKEN must be a FINE-GRAINED personal access token, scoped
// to exactly this repository with Actions: read-and-write permission and
// nothing else — no code read, no other repos, no secrets access. That scope
// is what makes holding this on a public-facing server a reasonable trade:
// if it leaked, the worst a holder could do is start/cancel workflow runs on
// this one repo. Set an expiry on it (GitHub requires fine-grained tokens to
// have one) so a forgotten leak doesn't stay live indefinitely.
//
// Never throws. A GitHub outage, a wrong token, a rate limit — none of that
// should block queueing a run; the job still gets executed eventually by the
// workflow's own schedule or a local worker polling. This is a nice-to-have
// speed-up, not something the queue path can depend on succeeding.

const GITHUB_API = "https://api.github.com";

function config() {
  return {
    token: process.env.GITHUB_TRIGGER_TOKEN || "",
    owner: process.env.GITHUB_TRIGGER_OWNER || "",
    repo: process.env.GITHUB_TRIGGER_REPO || "",
    workflow: process.env.GITHUB_TRIGGER_WORKFLOW || "pipeline.yml",
    ref: process.env.GITHUB_TRIGGER_REF || "main",
  };
}

export function githubTriggerConfigured() {
  const c = config();
  return !!(c.token && c.owner && c.repo);
}

// Pure and testable without a network call.
export function buildDispatchUrl({ owner, repo, workflow }) {
  return `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
}

const state = { lastTriggerAt: null, lastOk: null, lastError: null };
export function githubTriggerStatus() {
  return { configured: githubTriggerConfigured(), ...state };
}

export async function triggerWorkflow() {
  const c = config();
  if (!githubTriggerConfigured()) return { skipped: "not configured" };

  try {
    const res = await fetch(buildDispatchUrl(c), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: c.ref }),
      signal: AbortSignal.timeout(10000),
    });

    // workflow_dispatch returns 204 with no body on success.
    if (res.status !== 204) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    state.lastTriggerAt = new Date();
    state.lastOk = true;
    state.lastError = null;
    return { triggered: true };
  } catch (err) {
    state.lastTriggerAt = new Date();
    state.lastOk = false;
    state.lastError = err.message;
    console.warn(`[githubTrigger] failed to wake the Actions workflow (job still queued, will run on schedule): ${err.message}`);
    return { triggered: false, error: err.message };
  }
}
