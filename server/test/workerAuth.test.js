import { test } from "node:test";
import assert from "node:assert/strict";

// workerAuth reads WORKER_API_KEY at import time, so the env has to be set
// before the module is loaded — hence the dynamic import with a cache-busting
// query rather than a top-level import.
async function loadWithKey(key) {
  if (key === undefined) delete process.env.WORKER_API_KEY;
  else process.env.WORKER_API_KEY = key;
  return import(`../src/middleware/workerAuth.js?k=${encodeURIComponent(String(key))}-${Math.random()}`);
}

function fakeReq(headers = {}) {
  return { get: (h) => headers[h.toLowerCase()] };
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const GOOD = "k".repeat(32);

test("workerAuthConfigured rejects a short or missing key", async () => {
  assert.equal((await loadWithKey(undefined)).workerAuthConfigured(), false);
  assert.equal((await loadWithKey("")).workerAuthConfigured(), false);
  assert.equal((await loadWithKey("tooshort")).workerAuthConfigured(), false);
  assert.equal((await loadWithKey(GOOD)).workerAuthConfigured(), true);
});

test("requireWorker fails closed when no key is configured", async () => {
  // An unset key must never mean "anyone may post leads into the CRM".
  const { requireWorker } = await loadWithKey(undefined);
  const res = fakeRes();
  let nexted = false;
  requireWorker(fakeReq({ "x-worker-key": "anything" }), res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 503);
});

test("requireWorker rejects a missing key", async () => {
  const { requireWorker } = await loadWithKey(GOOD);
  const res = fakeRes();
  requireWorker(fakeReq({}), res, () => assert.fail("should not pass"));
  assert.equal(res.statusCode, 401);
});

test("requireWorker rejects a wrong key of the same length", async () => {
  const { requireWorker } = await loadWithKey(GOOD);
  const res = fakeRes();
  requireWorker(fakeReq({ "x-worker-key": "x".repeat(32) }), res, () => assert.fail("should not pass"));
  assert.equal(res.statusCode, 401);
});

test("requireWorker rejects a wrong key of a different length without throwing", async () => {
  // timingSafeEqual throws on length mismatch — the guard has to catch that
  // case itself or a short key becomes a 500 instead of a 401.
  const { requireWorker } = await loadWithKey(GOOD);
  const res = fakeRes();
  requireWorker(fakeReq({ "x-worker-key": "short" }), res, () => assert.fail("should not pass"));
  assert.equal(res.statusCode, 401);
});

test("requireWorker accepts the right key and records the worker id", async () => {
  const { requireWorker } = await loadWithKey(GOOD);
  const req = fakeReq({ "x-worker-key": GOOD, "x-worker-id": "desktop" });
  let nexted = false;
  requireWorker(req, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.workerId, "desktop");
});

test("requireWorker defaults the worker id when the header is absent", async () => {
  const { requireWorker } = await loadWithKey(GOOD);
  const req = fakeReq({ "x-worker-key": GOOD });
  requireWorker(req, fakeRes(), () => {});
  assert.equal(req.workerId, "unknown-worker");
});
