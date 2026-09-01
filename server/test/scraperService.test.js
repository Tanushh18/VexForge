import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEmails, isPrivateIp } from "../src/services/scraperService.js";

test("extractEmails finds mailto links", () => {
  const html = `<a href="mailto:hello@acme.example?subject=hi">Email us</a>`;
  assert.deepEqual(extractEmails(html), ["hello@acme.example"]);
});

test("extractEmails finds plain-text emails in body copy", () => {
  const html = `<body>Reach us at contact@acme.example or sales@acme.example.</body>`;
  const found = extractEmails(html);
  assert.ok(found.includes("contact@acme.example"));
  assert.ok(found.includes("sales@acme.example"));
});

test("extractEmails dedupes and lowercases", () => {
  const html = `<body><a href="mailto:Hi@Acme.example">Email</a><p>hi@acme.example</p></body>`;
  assert.deepEqual(extractEmails(html), ["hi@acme.example"]);
});

test("extractEmails doesn't fuse adjacent elements' text with no whitespace between them", () => {
  // Minified real-world HTML often has zero whitespace between tags — a
  // naive .text() concatenation would read this as one bogus token.
  const html = `<body><span>Contact</span><span>hi@acme.example</span></body>`;
  assert.deepEqual(extractEmails(html), ["hi@acme.example"]);
});

test("extractEmails filters known noise domains (analytics/CMS artifacts)", () => {
  const html = `<body>noreply@sentry.io real@acme.example</body>`;
  const found = extractEmails(html);
  assert.ok(!found.includes("noreply@sentry.io"));
  assert.ok(found.includes("real@acme.example"));
});

test("isPrivateIp rejects loopback, RFC1918, and link-local (incl. cloud metadata)", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.0.0.5"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("169.254.169.254"), true); // cloud metadata endpoint
  assert.equal(isPrivateIp("::1"), true);
});

test("isPrivateIp allows public addresses", () => {
  assert.equal(isPrivateIp("93.184.216.34"), false); // example.com
  assert.equal(isPrivateIp("8.8.8.8"), false);
});
