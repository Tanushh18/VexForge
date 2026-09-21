import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEmails, isPrivateIp, normalizeUrl } from "../src/services/contactScraper.js";

// The browser tier moved to the worker; this covers what the server kept —
// the static pass that auto-enriches a manually-added lead.

test("extractEmails pulls addresses out of mailto links", () => {
  const emails = extractEmails('<body><a href="mailto:Hi@Acme.example?subject=x">write</a></body>');
  assert.deepEqual(emails, ["hi@acme.example"]);
});

test("extractEmails finds plain-text addresses in the body", () => {
  assert.ok(extractEmails("<body><p>reach us at founders@acme.example</p></body>").includes("founders@acme.example"));
});

test("extractEmails does not fuse adjacent elements into a bogus address", () => {
  // cheerio's .text() concatenates with no separator, which on minified HTML
  // turns "Email" + "hi@acme.example" into one unusable token.
  const emails = extractEmails("<body><span>Email</span><span>hi@acme.example</span></body>");
  assert.ok(emails.includes("hi@acme.example"));
});

test("extractEmails filters out platform noise", () => {
  const emails = extractEmails("<body>a@example.com b@sentry.io real@acme.test</body>");
  assert.deepEqual(emails, ["real@acme.test"]);
});

test("normalizeUrl adds a scheme and strips a trailing slash", () => {
  assert.equal(normalizeUrl("acme.example/"), "https://acme.example");
  assert.equal(normalizeUrl("http://acme.example"), "http://acme.example");
});

test("isPrivateIp rejects loopback, RFC1918 and link-local (incl. cloud metadata)", () => {
  for (const ip of ["127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "fe80::1"]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test("isPrivateIp allows public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});
