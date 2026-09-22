import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionByContact } from "../src/pipeline.js";

test("partitionByContact separates leads with and without an email", () => {
  const { withContact, dropped } = partitionByContact([
    { companyName: "Acme", contactEmail: "hi@acme.example" },
    { companyName: "Beta" },
    { companyName: "Gamma", contactEmail: "" },
  ]);
  assert.deepEqual(withContact.map((l) => l.companyName), ["Acme"]);
  assert.deepEqual(dropped.map((l) => l.companyName), ["Beta", "Gamma"]);
});

test("partitionByContact handles an empty list", () => {
  assert.deepEqual(partitionByContact([]), { withContact: [], dropped: [] });
});

test("partitionByContact keeps every lead when all have contact info", () => {
  const leads = [{ companyName: "A", contactEmail: "a@a.example" }, { companyName: "B", contactEmail: "b@b.example" }];
  const { withContact, dropped } = partitionByContact(leads);
  assert.equal(withContact.length, 2);
  assert.equal(dropped.length, 0);
});
