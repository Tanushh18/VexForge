import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLaunchTitle, isUsableCompanyUrl } from "../src/services/leadSources/hnLaunches.js";
import { pickProductLinks, slugToName } from "../src/services/leadSources/productHunt.js";
import { pickCompanySlugs, directoryUrl } from "../src/services/leadSources/ycDirectory.js";
import { cleanOutboundUrl, isPlatformDomain } from "../src/services/leadSources/browser.js";

test("parseLaunchTitle pulls the company name out of a Launch HN title", () => {
  const { name, description } = parseLaunchTitle("Launch HN: Acme — AI scheduling for dentists");
  assert.equal(name, "Acme");
  assert.equal(description, "AI scheduling for dentists");
});

test("parseLaunchTitle strips the YC batch and reports it separately", () => {
  const { name, ycBatch } = parseLaunchTitle("Launch HN: Acme (YC W24) — AI for dentists");
  assert.equal(name, "Acme");
  assert.equal(ycBatch, "YC W24");
});

test("parseLaunchTitle handles a title with no description", () => {
  const { name, description } = parseLaunchTitle("Show HN: Bolt");
  assert.equal(name, "Bolt");
  assert.equal(description, null);
});

test("isUsableCompanyUrl rejects links that point back at a platform", () => {
  assert.equal(isUsableCompanyUrl("https://acme.example"), true);
  assert.equal(isUsableCompanyUrl("https://github.com/acme"), false);
  assert.equal(isUsableCompanyUrl("https://news.ycombinator.com/item?id=1"), false);
  assert.equal(isUsableCompanyUrl(undefined), false);
  assert.equal(isUsableCompanyUrl("not a url"), false);
});

test("pickProductLinks dedupes product slugs and ignores unrelated links", () => {
  const slugs = pickProductLinks([
    "/products/acme-app",
    "/products/acme-app?ref=home",
    "/posts/something-else",
    "/about",
    null,
  ]);
  assert.deepEqual(slugs, ["acme-app"]);
});

test("slugToName turns a slug into something presentable", () => {
  assert.equal(slugToName("acme-app"), "Acme App");
});

test("pickCompanySlugs only takes YC company profile links", () => {
  const slugs = pickCompanySlugs(["/companies/acme", "/companies/acme?batch=W24", "/companies/founders", "/blog/post", "/about"]);
  assert.deepEqual(slugs, ["acme"]);
});

test("directoryUrl encodes batch and hiring filters", () => {
  assert.equal(directoryUrl(), "https://www.ycombinator.com/companies");
  const url = directoryUrl({ batches: ["W24", "S24"], hiringOnly: true });
  assert.ok(url.includes("batch=W24"));
  assert.ok(url.includes("batch=S24"));
  assert.ok(url.includes("isHiring=true"));
});

test("cleanOutboundUrl unwraps a redirector and drops query/hash noise", () => {
  assert.equal(
    cleanOutboundUrl("https://ph.co/r?url=https%3A%2F%2Facme.example%2Fhome%3Futm_source%3Dph"),
    "https://acme.example/home"
  );
  assert.equal(cleanOutboundUrl("https://acme.example/#top"), "https://acme.example");
});

test("cleanOutboundUrl refuses non-http schemes and junk", () => {
  assert.equal(cleanOutboundUrl("javascript:alert(1)"), null);
  assert.equal(cleanOutboundUrl("mailto:hi@acme.example"), null);
  assert.equal(cleanOutboundUrl("/relative/path"), null);
  assert.equal(cleanOutboundUrl(null), null);
});

test("isPlatformDomain matches subdomains of a platform host", () => {
  assert.equal(isPlatformDomain("https://www.producthunt.com/x", ["producthunt.com"]), true);
  assert.equal(isPlatformDomain("https://cdn.producthunt.com/x", ["producthunt.com"]), true);
  assert.equal(isPlatformDomain("https://acme.example", ["producthunt.com"]), false);
  assert.equal(isPlatformDomain(null, ["producthunt.com"]), true);
});
