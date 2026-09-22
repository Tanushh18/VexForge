import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORY_SOURCES } from "../src/leadSources/directorySites.js";
import { SOURCES, listSources } from "../src/leadSources/index.js";

test("there are 15 generic-directory sources", () => {
  assert.equal(DIRECTORY_SOURCES.length, 15);
});

test("every directory source has the standard {key, label, needsBrowser, run} shape", () => {
  for (const s of DIRECTORY_SOURCES) {
    assert.equal(typeof s.key, "string");
    assert.ok(s.key.length > 0);
    assert.equal(typeof s.label, "string");
    assert.equal(s.needsBrowser, true);
    assert.equal(typeof s.run, "function");
  }
});

test("every source key across the whole registry is unique", () => {
  const keys = SOURCES.map((s) => s.key);
  assert.equal(keys.length, 23);
  assert.equal(new Set(keys).size, 23, `duplicate keys: ${keys.filter((k, i) => keys.indexOf(k) !== i).join(", ")}`);
});

test("listSources reports needsBrowser accurately per source", () => {
  const list = listSources();
  const noBrowser = list.filter((s) => !s.needsBrowser).map((s) => s.key);
  assert.deepEqual(noBrowser.sort(), [
    "funding_news", "funding_news_global", "hn_hiring", "hn_launches", "reddit_launches", "show_hn",
  ]);
});
