import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, normalizeDomain, escapeRegex } from "../src/routes/leads.js";

test("parseCsv splits a simple CSV into rows of fields", () => {
  const rows = parseCsv("companyName,website\nAcme,acme.example\nBeta,beta.example");
  assert.deepEqual(rows, [
    ["companyName", "website"],
    ["Acme", "acme.example"],
    ["Beta", "beta.example"],
  ]);
});

test("parseCsv handles quoted fields with embedded commas", () => {
  const rows = parseCsv('companyName,notes\nAcme,"Met at expo, booth 12"');
  assert.deepEqual(rows, [
    ["companyName", "notes"],
    ["Acme", "Met at expo, booth 12"],
  ]);
});

test("parseCsv handles escaped double quotes inside a quoted field", () => {
  const rows = parseCsv('companyName,notes\nAcme,"Said ""hello"" to us"');
  assert.equal(rows[1][1], 'Said "hello" to us');
});

test("parseCsv skips blank lines", () => {
  const rows = parseCsv("companyName\nAcme\n\nBeta\n");
  assert.deepEqual(rows, [["companyName"], ["Acme"], ["Beta"]]);
});

test("normalizeDomain strips protocol, www, and path", () => {
  assert.equal(normalizeDomain("https://www.acme.example/contact"), "acme.example");
  assert.equal(normalizeDomain("acme.example"), "acme.example");
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain(undefined), null);
});

test("escapeRegex neutralizes regex metacharacters", () => {
  const pattern = new RegExp(`^${escapeRegex("a.b+c(d)")}$`);
  assert.equal(pattern.test("a.b+c(d)"), true);
  assert.equal(pattern.test("aXbYc(d)"), false);
});
