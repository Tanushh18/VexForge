import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowedOrigins, originChecker } from "../src/config/origins.js";

const check = (allowed, origin) =>
  new Promise((resolve) => originChecker(allowed)(origin, (err, ok) => resolve(err ? false : ok)));

test("parseAllowedOrigins falls back to the Vite dev server", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), ["http://localhost:5173"]);
  assert.deepEqual(parseAllowedOrigins(""), ["http://localhost:5173"]);
});

test("parseAllowedOrigins splits a comma-separated list and trims it", () => {
  assert.deepEqual(
    parseAllowedOrigins("https://a.example, https://b.example"),
    ["https://a.example", "https://b.example"]
  );
});

test("parseAllowedOrigins adds https to a bare hostname", () => {
  // Render's `fromService` host property hands over a hostname with no scheme.
  assert.deepEqual(parseAllowedOrigins("vexforge-hq.onrender.com"), ["https://vexforge-hq.onrender.com"]);
});

test("parseAllowedOrigins leaves an explicit http origin alone", () => {
  assert.deepEqual(parseAllowedOrigins("http://localhost:4173"), ["http://localhost:4173"]);
});

test("parseAllowedOrigins strips trailing slashes, which never appear in an Origin header", () => {
  assert.deepEqual(parseAllowedOrigins("https://a.example/"), ["https://a.example"]);
});

test("parseAllowedOrigins drops empty entries from a trailing comma", () => {
  assert.deepEqual(parseAllowedOrigins("https://a.example,,"), ["https://a.example"]);
});

test("originChecker allows a listed origin", async () => {
  assert.equal(await check(parseAllowedOrigins("https://a.example"), "https://a.example"), true);
});

test("originChecker rejects an unlisted origin", async () => {
  assert.equal(await check(parseAllowedOrigins("https://a.example"), "https://evil.example"), false);
});

test("originChecker allows a request with no Origin header", async () => {
  // Same-origin requests, curl, and platform health probes send none.
  assert.equal(await check(parseAllowedOrigins("https://a.example"), undefined), true);
});

test("originChecker matches a tunnel origin configured without a scheme", async () => {
  const allowed = parseAllowedOrigins("vexforge-hq.onrender.com");
  assert.equal(await check(allowed, "https://vexforge-hq.onrender.com"), true);
});
