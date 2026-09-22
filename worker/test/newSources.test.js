import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHiringComment } from "../src/leadSources/hnHiring.js";
import { cleanCompanyName } from "../src/leadSources/fundingNews.js";
import { nameSlugs, candidateDomains, pageNamesCompany } from "../src/resolveWebsite.js";

test("parseHiringComment reads the Company | Role | Location convention", () => {
  const c = parseHiringComment('<p>Acme Health (YC W24) | Senior Engineer | Remote | https:&#x2F;&#x2F;acme.io</p><p>We build...</p>');
  assert.equal(c.name, "Acme Health");
  assert.equal(c.website, "https://acme.io");
});

test("parseHiringComment prefers the company site over an ATS link", () => {
  const c = parseHiringComment('<p>Beta | Backend | Onsite</p><p><a href="https://boards.greenhouse.io/beta">apply</a> <a href="https://beta.dev">site</a></p>');
  assert.equal(c.website, "https://beta.dev");
});

test("parseHiringComment skips comments that don't follow the convention", () => {
  assert.equal(parseHiringComment("<p>Does anyone know if this thread is monthly?</p>"), null);
});

test("nameSlugs strips corporate suffixes and punctuation", () => {
  assert.deepEqual(nameSlugs("Acme Labs Pvt. Ltd."), ["acme"]);
  assert.ok(nameSlugs("Zip Health").includes("ziphealth"));
});

test("candidateDomains covers the shapes startups actually use", () => {
  const d = candidateDomains("Zip Health");
  for (const want of ["ziphealth.com", "ziphealth.io", "getziphealth.com", "ziphealthhq.com", "ziphealth.co.in"]) {
    assert.ok(d.includes(want), `missing ${want}`);
  }
});

test("pageNamesCompany only accepts a site that names the company", () => {
  assert.ok(pageNamesCompany("Zip Health", { title: "ZipHealth — care for teams", textSample: "" }));
  assert.ok(pageNamesCompany("Zip Health", { title: "Home", textSample: "Welcome to Zip Health, the clinic platform." }));
  assert.equal(pageNamesCompany("Zip Health", { title: "Bob's Plumbing", textSample: "We fix pipes." }), false);
});

test("cleanCompanyName strips headline descriptors around the company name", () => {
  assert.equal(cleanCompanyName("AI startup Mantic"), "Mantic");
  assert.equal(cleanCompanyName("Portland startup Antfly"), "Antfly");
  assert.equal(cleanCompanyName("Five months old, Noetive"), "Noetive");
  assert.equal(cleanCompanyName("Fintech platform Jupiter"), "Jupiter");
  assert.equal(cleanCompanyName("Zepto"), "Zepto"); // a clean name is left alone
});
