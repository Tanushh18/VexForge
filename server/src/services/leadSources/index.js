import { withBrowser, safeSource } from "./browser.js";
import hnLaunches from "./hnLaunches.js";
import productHunt from "./productHunt.js";
import ycDirectory from "./ycDirectory.js";

// The discovery registry. Every adapter reads *public* listing pages only and
// returns partial leads — company name, website, a description, and the
// timing signals the listing itself proves (just launched / just funded /
// hiring). Contact details are never taken from these sites; they come from
// each company's own site in the enrichment step.
//
// Adding a source means adding one module here with the same shape:
//   { key, label, needsBrowser, run(contextOrOptions, options) }

export const SOURCES = [hnLaunches, productHunt, ycDirectory];

export function listSources() {
  return SOURCES.map(({ key, label, needsBrowser }) => ({ key, label, needsBrowser }));
}

export function getSource(key) {
  return SOURCES.find((s) => s.key === key) || null;
}

// Runs the requested sources and returns one result record per source. A
// browser is launched only if at least one selected source needs it, so an
// HN-only run stays a plain HTTP call.
export async function discoverLeads({ sources = SOURCES.map((s) => s.key), perSource = 15 } = {}) {
  const selected = sources.map(getSource).filter(Boolean);
  if (!selected.length) return [];

  const browserless = selected.filter((s) => !s.needsBrowser);
  const needBrowser = selected.filter((s) => s.needsBrowser);

  const results = [];
  for (const source of browserless) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await safeSource(source.key, () => source.run({ limit: perSource })));
  }

  if (needBrowser.length) {
    const browserResults = await withBrowser(async (context) => {
      const out = [];
      for (const source of needBrowser) {
        // Sequential on purpose: a lead-gen crawler visiting a handful of
        // public pages slowly is a good citizen; the same pages hit in
        // parallel from one IP is what gets a scraper blocked.
        // eslint-disable-next-line no-await-in-loop
        out.push(await safeSource(source.key, () => source.run(context, { limit: perSource })));
      }
      return out;
    }).catch((err) => [{ source: "browser", ok: false, found: 0, leads: [], error: err.message }]);
    results.push(...browserResults);
  }

  return results;
}
