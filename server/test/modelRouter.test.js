import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonLoose, ROLES, MODELS } from "../../shared/modelRouter.js";
import { startOfDay, DAILY_SEND_CAP } from "../src/services/sendQuotaService.js";

test("parseJsonLoose reads clean JSON", () => {
  assert.deepEqual(parseJsonLoose('{"adjustment":5}'), { adjustment: 5 });
});

test("parseJsonLoose salvages JSON wrapped in the model's chatter", () => {
  assert.deepEqual(
    parseJsonLoose('Sure! Here you go:\n{"adjustment": -3, "reason": "small team"}\nHope that helps.'),
    { adjustment: -3, reason: "small team" }
  );
});

test("parseJsonLoose handles nested objects and braces inside strings", () => {
  assert.deepEqual(
    parseJsonLoose('{"reason":"uses {braces} oddly","meta":{"n":1}}'),
    { reason: "uses {braces} oddly", meta: { n: 1 } }
  );
});

test("parseJsonLoose handles an escaped quote inside a string", () => {
  assert.deepEqual(parseJsonLoose('{"reason":"they said \\"no\\""}'), { reason: 'they said "no"' });
});

test("parseJsonLoose returns null rather than throwing on unusable output", () => {
  assert.equal(parseJsonLoose("no json at all"), null);
  assert.equal(parseJsonLoose('{"broken": '), null);
  assert.equal(parseJsonLoose(""), null);
  assert.equal(parseJsonLoose(undefined), null);
});

test("every role has a model configured", () => {
  for (const role of ROLES) {
    assert.equal(typeof MODELS[role], "string");
    assert.ok(MODELS[role].length > 0);
  }
});

test("startOfDay zeroes the clock without moving the date", () => {
  const d = startOfDay(new Date("2026-03-04T17:45:12.000Z"));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});

test("the daily send cap is a positive number", () => {
  assert.ok(Number.isFinite(DAILY_SEND_CAP));
  assert.ok(DAILY_SEND_CAP > 0);
});
