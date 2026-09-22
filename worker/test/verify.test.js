import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSiteContent, assessEmailShape, baseDomain, mergeBySite, mapLimit } from "../src/verify.js";

const body = (text) => `<html><head><title>Acme — invoicing for clinics</title></head><body><p>${text}</p></body></html>`;
const LONG = "Acme helps small clinics send invoices and get paid faster. ".repeat(5);

test("a live company site passes", () => {
  const r = assessSiteContent({ html: body(`${LONG} See pricing.`), finalUrl: "https://acme.io/", status: 200 });
  assert.equal(r.ok, true);
  assert.ok(r.signals.includes("active_product"));
});

test("parked, for-sale and error pages are rejected", () => {
  assert.equal(assessSiteContent({ html: body(`${LONG} This domain is for sale!`), finalUrl: "https://acme.io", status: 200 }).reason, "parked_or_placeholder");
  assert.equal(assessSiteContent({ html: body(LONG), finalUrl: "https://sedo.com/search?q=acme", status: 200 }).reason, "parked_redirect");
  assert.equal(assessSiteContent({ html: "", finalUrl: "https://acme.io", status: 404 }).reason, "http_404");
  assert.equal(assessSiteContent({ html: body(LONG), finalUrl: "https://www.linkedin.com/company/acme", status: 200 }).reason, "not_own_site");
});

test("an empty page fails but a JS app shell with a title passes", () => {
  assert.equal(assessSiteContent({ html: body("hi"), finalUrl: "https://acme.io", status: 200 }).reason, "empty_page");
  const spa = '<html><head><title>Acme</title></head><body><div id="root"></div></body></html>';
  assert.equal(assessSiteContent({ html: spa, finalUrl: "https://acme.io", status: 200 }).ok, true);
});

test("stale copyright and plain http are flagged as openings", () => {
  const r = assessSiteContent({ html: body(`${LONG} © 2019 Acme`), finalUrl: "http://acme.io", status: 200, now: new Date("2026-09-22") });
  assert.ok(r.signals.includes("outdated_site"));
  assert.ok(r.signals.includes("no_https"));
});

test("email shape checks", () => {
  assert.equal(assessEmailShape("logo@2x.png").reason, "malformed");
  assert.equal(assessEmailShape("noreply@acme.io").reason, "no_reply");
  assert.equal(assessEmailShape("x@mailinator.com").reason, "disposable");
  const own = assessEmailShape("priya@acme.io", "https://www.acme.io");
  assert.ok(own.ok && own.signals.includes("email_on_company_domain") && own.signals.includes("personal_inbox"));
  const role = assessEmailShape("hello@acme.io", "acme.io");
  assert.ok(role.signals.includes("role_inbox"));
  assert.ok(assessEmailShape("founder@gmail.com", "acme.io").signals.includes("free_mail"));
});

test("baseDomain handles subdomains and country second-levels", () => {
  assert.equal(baseDomain("mail.acme.io"), "acme.io");
  assert.equal(baseDomain("shop.acme.co.in"), "acme.co.in");
});

test("mergeBySite folds duplicates and marks multi-source companies", () => {
  const merged = mergeBySite([
    { companyName: "Acme", website: "https://acme.io", discoverySource: "producthunt", signals: ["just_launched"] },
    { companyName: "ACME Inc", website: "https://www.acme.io/", discoverySource: "funding", signals: ["just_funded"] },
    { companyName: "Beta", website: "https://beta.dev", discoverySource: "hn" },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].seenIn, ["producthunt", "funding"]);
  assert.ok(merged[0].signals.includes("just_funded") && merged[0].signals.includes("multi_source"));
  assert.ok(!merged[1].signals.includes("multi_source"));
});

test("mapLimit keeps order", async () => {
  const out = await mapLimit([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 5));
    return n * 10;
  });
  assert.deepEqual(out, [30, 10, 20]);
});
