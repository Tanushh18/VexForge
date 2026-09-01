import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, findEnumMention } from "../src/services/llmService.js";

// These test the deterministic part of Ember's chat router — the piece that
// picks a tool WITHOUT calling the local model, which is the whole point of
// routing this way instead of letting a 3B model choose freely.

test("classify recognizes a status-update request", () => {
  assert.equal(classify("give me a company status update"), "status");
  assert.equal(classify("how are things going"), "status");
});

test("classify recognizes a department query", () => {
  assert.equal(classify("what's the Operations team working on"), "department");
});

test("classify recognizes leads/outreach/tickets/activity requests", () => {
  assert.equal(classify("list new leads"), "leads");
  assert.equal(classify("show me the outreach queue"), "outreach");
  assert.equal(classify("any open tickets"), "tickets");
  assert.equal(classify("what happened recently"), "activity");
});

test("classify returns null for unrecognized input, not a guess", () => {
  assert.equal(classify("what's the weather like"), null);
});

test("findEnumMention matches a known value mentioned in free text", () => {
  const stages = ["new", "reviewed", "won", "lost"];
  assert.equal(findEnumMention("show me leads that are won", stages), "won");
});

test("findEnumMention returns undefined when nothing matches", () => {
  const stages = ["new", "reviewed", "won", "lost"];
  assert.equal(findEnumMention("show me all the leads", stages), undefined);
});
