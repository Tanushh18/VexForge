import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRotationBatch, validSources, SOURCE_CATALOGUE, ROTATION_BATCH_SIZE } from "../src/services/pipelineQueue.js";

const KEYS = ["a", "b", "c", "d", "e"];

test("pickRotationBatch returns a contiguous slice starting at the cursor", () => {
  const { batch, nextCursor } = pickRotationBatch(KEYS, 0, 3);
  assert.deepEqual(batch, ["a", "b", "c"]);
  assert.equal(nextCursor, 3);
});

test("pickRotationBatch wraps around the end of the list", () => {
  const { batch, nextCursor } = pickRotationBatch(KEYS, 4, 3);
  assert.deepEqual(batch, ["e", "a", "b"]);
  assert.equal(nextCursor, 2);
});

test("pickRotationBatch caps the batch size to the number of keys", () => {
  const { batch } = pickRotationBatch(KEYS, 0, 999);
  assert.equal(batch.length, KEYS.length);
});

test("pickRotationBatch treats a stale or negative cursor safely", () => {
  assert.doesNotThrow(() => pickRotationBatch(KEYS, -3, 2));
  assert.doesNotThrow(() => pickRotationBatch(KEYS, 500, 2));
  const { batch } = pickRotationBatch(KEYS, -1, 2);
  assert.deepEqual(batch, ["e", "a"]);
});

test("pickRotationBatch handles an empty key list without throwing", () => {
  assert.deepEqual(pickRotationBatch([], 0, 5), { batch: [], nextCursor: 0 });
});

test("three full rotations of the batch size cover every key at least once", () => {
  const all = new Set();
  let cursor = 0;
  const rounds = Math.ceil(KEYS.length / 2) + 1;
  for (let i = 0; i < rounds; i++) {
    const { batch, nextCursor } = pickRotationBatch(KEYS, cursor, 2);
    batch.forEach((k) => all.add(k));
    cursor = nextCursor;
  }
  assert.deepEqual([...all].sort(), [...KEYS].sort());
});

test("validSources filters out keys not in the catalogue", () => {
  assert.deepEqual(validSources(["hn_launches", "not_a_real_source"]), ["hn_launches"]);
});

test("validSources returns an empty array for an all-invalid request, not the full catalogue", () => {
  // Explicit-but-wrong must fail loudly (enqueueRun turns this into a 400),
  // never silently fall back to "run everything".
  assert.deepEqual(validSources(["bogus"]), []);
});

test("the catalogue has 23 unique keys", () => {
  const keys = SOURCE_CATALOGUE.map((s) => s.key);
  assert.equal(keys.length, 23);
  assert.equal(new Set(keys).size, 23);
});

test("the rotation batch size is a positive number no larger than the catalogue", () => {
  assert.ok(ROTATION_BATCH_SIZE > 0);
  assert.ok(ROTATION_BATCH_SIZE <= SOURCE_CATALOGUE.length);
});
