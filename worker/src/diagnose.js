import { SOURCES, discoverLeads } from "./leadSources/index.js";

// Standalone verification for every discovery source — no deployed API, no
// WORKER_API_KEY, no database. Built for exactly the situation where you
// can't run the full worker (no always-on machine yet) but still need to
// know which of the 20 source configs in directorySites.js actually work:
// run this on any machine with real internet access — including a GitHub
// Actions runner — and read the per-source table it prints.
//
//   node src/diagnose.js                 # every source
//   node src/diagnose.js betalist uneed  # just these keys
//
// Exit code is non-zero if every source failed, so a CI step can flag a
// total outage (e.g. Playwright itself broken) without you reading the log.

const requested = process.argv.slice(2);
const sources = requested.length ? requested : SOURCES.map((s) => s.key);

console.log(`[diagnose] testing ${sources.length} source(s): ${sources.join(", ")}\n`);

const results = await discoverLeads({ sources, perSource: 5 });

const rows = results.map((r) => ({
  source: r.source,
  ok: r.ok,
  found: r.found,
  sample: r.leads[0] ? `${r.leads[0].companyName} → ${r.leads[0].website}` : "",
  error: r.error || "",
}));

const pad = (s, n) => String(s).slice(0, n).padEnd(n);
console.log(pad("SOURCE", 24) + pad("OK", 6) + pad("FOUND", 7) + "SAMPLE / ERROR");
console.log("-".repeat(100));
for (const row of rows) {
  console.log(pad(row.source, 24) + pad(row.ok ? "yes" : "NO", 6) + pad(row.found, 7) + (row.error || row.sample));
}

const working = rows.filter((r) => r.ok && r.found > 0).length;
const failing = rows.filter((r) => !r.ok).length;
const zeroResult = rows.filter((r) => r.ok && r.found === 0).length;
console.log(`\n[diagnose] ${working} working, ${zeroResult} returned 0 (ok, but likely a stale selector/URL), ${failing} errored`);

if (working === 0) {
  console.error("[diagnose] every source failed — check network access / Playwright install before trusting individual results");
  process.exit(1);
}
