import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreLead,
  detectSignals,
  bandFor,
  applyAdjustment,
  MAX_MODEL_ADJUSTMENT,
  SIGNAL_WEIGHTS,
} from "../src/services/scoringService.js";

test("detectSignals flags a reachable lead", () => {
  const signals = detectSignals({ companyName: "Acme", website: "acme.example", contactEmail: "hi@acme.example", contactName: "Dana" });
  assert.ok(signals.includes("has_website"));
  assert.ok(signals.includes("has_contact_email"));
  assert.ok(signals.includes("has_founder_name"));
  assert.ok(!signals.includes("no_contact_path"));
});

test("detectSignals flags a lead with no way to reach it", () => {
  const signals = detectSignals({ companyName: "Ghost Co" });
  assert.ok(signals.includes("no_contact_path"));
});

test("detectSignals keeps timing signals supplied by the discovery source", () => {
  const signals = detectSignals({ companyName: "Acme", signals: ["just_funded", "hiring"] });
  assert.ok(signals.includes("just_funded"));
  assert.ok(signals.includes("hiring"));
});

test("detectSignals recognises a target industry from any text field", () => {
  assert.ok(detectSignals({ companyName: "A", industry: "EdTech" }).includes("target_industry"));
  assert.ok(detectSignals({ companyName: "A", notes: "a proptech marketplace" }).includes("target_industry"));
});

test("detectSignals penalises other agencies", () => {
  assert.ok(detectSignals({ companyName: "Pixel Studio", notes: "a web design agency" }).includes("agency_or_competitor"));
});

test("scoreLead ranks a just-funded reachable startup above a bare name", () => {
  const strong = scoreLead({ companyName: "Acme", website: "acme.example", contactEmail: "founders@acme.example", signals: ["just_funded", "hiring"] });
  const weak = scoreLead({ companyName: "Nobody" });
  assert.ok(strong.score > weak.score);
  assert.equal(strong.scoreBand, "hot");
});

test("scoreLead clamps into 0..100", () => {
  const everything = scoreLead({
    companyName: "Acme",
    industry: "fintech",
    website: "acme.example",
    contactEmail: "a@acme.example",
    contactName: "Dana",
    signals: ["just_funded", "just_launched", "hiring"],
  });
  assert.ok(everything.score <= 100);
  assert.ok(scoreLead({ companyName: "X", notes: "consulting agency" }).score >= 0);
});

test("scoreLead is deterministic for the same input", () => {
  const lead = { companyName: "Acme", website: "acme.example", signals: ["just_launched"] };
  assert.deepEqual(scoreLead(lead), scoreLead(lead));
});

test("bandFor splits at the documented thresholds", () => {
  assert.equal(bandFor(70), "hot");
  assert.equal(bandFor(69), "warm");
  assert.equal(bandFor(45), "warm");
  assert.equal(bandFor(44), "cold");
});

test("applyAdjustment clamps the model's influence in both directions", () => {
  assert.equal(applyAdjustment(50, 99), 50 + MAX_MODEL_ADJUSTMENT);
  assert.equal(applyAdjustment(50, -99), 50 - MAX_MODEL_ADJUSTMENT);
  assert.equal(applyAdjustment(50, 5), 55);
});

test("applyAdjustment treats junk from the model as no opinion", () => {
  assert.equal(applyAdjustment(50, undefined), 50);
  assert.equal(applyAdjustment(50, "nonsense"), 50);
  assert.equal(applyAdjustment(50, null), 50);
});

test("applyAdjustment still respects the 0..100 bounds", () => {
  assert.equal(applyAdjustment(97, 15), 100);
  assert.equal(applyAdjustment(3, -15), 0);
});

test("a model adjustment cannot promote a cold lead to hot", () => {
  const cold = 44;
  assert.notEqual(bandFor(applyAdjustment(cold, MAX_MODEL_ADJUSTMENT)), "hot");
});

test("the missing-contact-path penalty outweighs any single positive except funding", () => {
  const penalty = Math.abs(SIGNAL_WEIGHTS.no_contact_path);
  assert.ok(penalty > SIGNAL_WEIGHTS.hiring);
  assert.ok(penalty > SIGNAL_WEIGHTS.target_industry);
});
