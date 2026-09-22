import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLaunchTitle, isUsableCompanyUrl } from "../src/leadSources/hnLaunches.js";
import { pickProductLinks, slugToName } from "../src/leadSources/productHunt.js";
import { pickCompanySlugs, directoryUrl, PLATFORM_HOSTS as YC_PLATFORM_HOSTS } from "../src/leadSources/ycDirectory.js";
import { isPlatformDomain as isYcPlatformDomain } from "../src/leadSources/browser.js";
import { cleanOutboundUrl, isPlatformDomain } from "../src/leadSources/browser.js";
import { isUsableCompanyUrl as redditUsableUrl, cleanTitle } from "../src/leadSources/redditLaunches.js";
import { stripPublisher, parseFundingTitle } from "../src/leadSources/fundingNews.js";

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

test("yc_directory's platform filter excludes YC's OWN other properties", () => {
  // Real bug from a live diagnostic run: without these, a company profile's
  // first non-ycombinator.com link could be one of YC's other domains
  // instead of the company's actual site — doordash's lead landed with
  // website=startupschool.org because that link happened to come first.
  assert.equal(isYcPlatformDomain("https://www.startupschool.org", YC_PLATFORM_HOSTS), true);
  assert.equal(isYcPlatformDomain("https://www.workatastartup.com/jobs/1", YC_PLATFORM_HOSTS), true);
  assert.equal(isYcPlatformDomain("https://acme.example", YC_PLATFORM_HOSTS), false);
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

// --- redditLaunches ---------------------------------------------------------

test("reddit isUsableCompanyUrl rejects links back into Reddit or media hosts", () => {
  assert.equal(redditUsableUrl("https://acme.example"), true);
  assert.equal(redditUsableUrl("https://i.redd.it/abc123.png"), false);
  assert.equal(redditUsableUrl("https://www.reddit.com/r/startups/comments/x"), false);
  assert.equal(redditUsableUrl(undefined), false);
});

test("reddit cleanTitle strips launch-phrase noise from a post title", () => {
  assert.equal(cleanTitle("I built Acme - feedback welcome!"), "Acme");
  assert.equal(cleanTitle("Launching Acme: AI for dentists"), "Acme: AI for dentists");
  assert.equal(cleanTitle("Acme"), "Acme");
});

test("reddit cleanTitle caps length so a rambling title doesn't become the company name", () => {
  const long = "We built " + "x".repeat(200);
  assert.ok(cleanTitle(long).length <= 120);
});

// --- fundingNews -------------------------------------------------------------

test("stripPublisher removes the trailing ' - Publisher' Google News appends", () => {
  assert.equal(stripPublisher("Acme raises $2M seed round - TechCrunch"), "Acme raises $2M seed round");
  assert.equal(stripPublisher("Acme raises $2M"), "Acme raises $2M"); // no publisher suffix present
});

test("parseFundingTitle extracts the company name before the funding verb", () => {
  const result = parseFundingTitle("Acme Robotics raises $2M seed round to build widgets - TechCrunch");
  assert.equal(result.name, "Acme Robotics");
  assert.equal(result.description, "Acme Robotics raises $2M seed round to build widgets");
});

test("parseFundingTitle handles other funding verbs (secures, bags, lands)", () => {
  assert.equal(parseFundingTitle("Acme secures ₹15 Crore in Series A - Entrackr").name, "Acme");
  assert.equal(parseFundingTitle("Beta bags $500K pre-seed - YourStory").name, "Beta");
});

test("parseFundingTitle returns null for a headline with no funding verb", () => {
  assert.equal(parseFundingTitle("Acme launches new product - TechCrunch"), null);
  assert.equal(parseFundingTitle("Just a regular headline with no company"), null);
});
