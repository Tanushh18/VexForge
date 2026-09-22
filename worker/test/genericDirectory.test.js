import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDirectoryLeads, isLikelyCompanyName } from "../src/leadSources/genericDirectory.js";

test("isLikelyCompanyName accepts a plausible product name", () => {
  assert.equal(isLikelyCompanyName("Acme Widgets"), true);
});

test("isLikelyCompanyName rejects UI chrome text", () => {
  for (const t of ["Visit", "Website", "Sign up", "Learn More", "→", "View"]) {
    assert.equal(isLikelyCompanyName(t), false, `"${t}" should be rejected`);
  }
});

test("isLikelyCompanyName rejects empty, too-short, too-long, or URL-as-text", () => {
  assert.equal(isLikelyCompanyName(""), false);
  assert.equal(isLikelyCompanyName("  "), false);
  assert.equal(isLikelyCompanyName("A"), false);
  assert.equal(isLikelyCompanyName("x".repeat(61)), false);
  assert.equal(isLikelyCompanyName("https://acme.example"), false);
});

// Every case below is a real result from a live diagnostic run
// (worker/src/diagnose.js on GitHub Actions), not a hypothetical — each one
// slipped through before these checks were added.

test("isLikelyCompanyName rejects a marketing sentence masquerading as a name", () => {
  // alternativeto.net: an affiliate ad's link text, not a product name.
  assert.equal(
    isLikelyCompanyName("Proton VPN High speed private VPN protected by strong Swiss privacy laws"),
    false
  );
});

test("isLikelyCompanyName rejects substrings that mark a link as chrome, not a product", () => {
  assert.equal(isLikelyCompanyName("Feedback"), false); // saashub.com's typeform link
  assert.equal(isLikelyCompanyName("Get this banner for free"), false); // launchingnext.com's ad widget
  assert.equal(isLikelyCompanyName("Accept cookies"), false);
  assert.equal(isLikelyCompanyName("Subscribe to our newsletter"), false);
});

test("isLikelyCompanyName still accepts an ordinary multi-word product name", () => {
  assert.equal(isLikelyCompanyName("NextJS Starter"), true); // devhunt.org, a real result
  assert.equal(isLikelyCompanyName("Startup Jobs"), true);
});

test("extractDirectoryLeads keeps a real outbound link with a usable name", () => {
  const leads = extractDirectoryLeads([{ href: "https://acme.example/", text: "Acme" }]);
  assert.deepEqual(leads, [{ companyName: "Acme", website: "https://acme.example" }]);
});

test("extractDirectoryLeads drops platform/social links", () => {
  const leads = extractDirectoryLeads([
    { href: "https://twitter.com/acme", text: "Acme" },
    { href: "https://github.com/acme/repo", text: "Acme" },
    { href: "https://betalist.com/about", text: "About" },
  ], ["betalist.com"]);
  assert.deepEqual(leads, []);
});

test("extractDirectoryLeads drops the ad/form/error hosts a real run surfaced", () => {
  const leads = extractDirectoryLeads([
    { href: "https://saashub.typeform.com/to/gSej0f", text: "Feedback" },
    { href: "https://silktide.com/consent-manager", text: "Get this banner for free" },
    { href: "https://www.cloudflare.com/5xx-error-landing", text: "Cloudflare" },
  ]);
  assert.deepEqual(leads, []);
});

test("extractDirectoryLeads drops links with noise text even if the URL is fine", () => {
  const leads = extractDirectoryLeads([{ href: "https://acme.example", text: "Visit" }]);
  assert.deepEqual(leads, []);
});

test("extractDirectoryLeads dedupes by domain, keeping the first occurrence", () => {
  const leads = extractDirectoryLeads([
    { href: "https://acme.example/", text: "Acme" },
    { href: "https://acme.example/pricing", text: "Acme Pricing Page" },
  ]);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].companyName, "Acme");
});

test("extractDirectoryLeads ignores malformed hrefs without throwing", () => {
  const leads = extractDirectoryLeads([
    { href: "javascript:void(0)", text: "Acme" },
    { href: null, text: "Acme" },
    { href: "/relative", text: "Acme" },
  ]);
  assert.deepEqual(leads, []);
});
