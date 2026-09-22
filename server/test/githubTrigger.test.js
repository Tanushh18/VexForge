import { test } from "node:test";
import assert from "node:assert/strict";

// githubTrigger reads its config from env at call time (not import time), so
// each test sets the env it needs before importing/calling — same pattern as
// workerAuth.test.js, which hit the same issue with a module-load guard.
async function loadWithEnv(env) {
  for (const k of ["GITHUB_TRIGGER_TOKEN", "GITHUB_TRIGGER_OWNER", "GITHUB_TRIGGER_REPO", "GITHUB_TRIGGER_WORKFLOW"]) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  return import(`../src/services/githubTrigger.js?t=${Math.random()}`);
}

test("githubTriggerConfigured requires token, owner and repo all set", async () => {
  assert.equal((await loadWithEnv({})).githubTriggerConfigured(), false);
  assert.equal((await loadWithEnv({ GITHUB_TRIGGER_TOKEN: "t" })).githubTriggerConfigured(), false);
  assert.equal(
    (await loadWithEnv({ GITHUB_TRIGGER_TOKEN: "t", GITHUB_TRIGGER_OWNER: "o" })).githubTriggerConfigured(),
    false
  );
  assert.equal(
    (
      await loadWithEnv({ GITHUB_TRIGGER_TOKEN: "t", GITHUB_TRIGGER_OWNER: "o", GITHUB_TRIGGER_REPO: "r" })
    ).githubTriggerConfigured(),
    true
  );
});

test("buildDispatchUrl targets the correct workflow_dispatch endpoint", async () => {
  const { buildDispatchUrl } = await loadWithEnv({});
  assert.equal(
    buildDispatchUrl({ owner: "Tanushh18", repo: "VexForge", workflow: "pipeline.yml" }),
    "https://api.github.com/repos/Tanushh18/VexForge/actions/workflows/pipeline.yml/dispatches"
  );
});

test("triggerWorkflow skips cleanly when not configured, without a network call", async () => {
  const { triggerWorkflow } = await loadWithEnv({});
  const result = await triggerWorkflow();
  assert.deepEqual(result, { skipped: "not configured" });
});

test("githubTriggerStatus reports configured before any trigger attempt", async () => {
  const { githubTriggerStatus } = await loadWithEnv({
    GITHUB_TRIGGER_TOKEN: "t",
    GITHUB_TRIGGER_OWNER: "o",
    GITHUB_TRIGGER_REPO: "r",
  });
  const status = githubTriggerStatus();
  assert.equal(status.configured, true);
  assert.equal(status.lastTriggerAt, null);
});

test("triggerWorkflow never throws on a bad token/repo — reports failure instead", async () => {
  // Hits the real api.github.com with a bogus owner/repo/token, standing in
  // for "the token is wrong" or "the repo doesn't exist" — GitHub answers
  // with a real 401/404 here rather than a connection failure, but the
  // contract under test is the same either way: never throw, always resolve
  // with { triggered: false, error }.
  const { triggerWorkflow } = await loadWithEnv({
    GITHUB_TRIGGER_TOKEN: "not-a-real-token",
    GITHUB_TRIGGER_OWNER: "definitely-not-a-real-owner-xyz",
    GITHUB_TRIGGER_REPO: "definitely-not-a-real-repo-xyz",
  });
  const result = await triggerWorkflow();
  assert.equal(result.triggered, false);
  assert.ok(result.error);
});
