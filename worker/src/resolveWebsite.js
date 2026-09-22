import dns from "node:dns/promises";
import { verifySite } from "./verify.js";

// Finds the website for a lead that arrived with only a company name — the
// funding-news sources, mainly, whose headlines ("Acme raises $3M") never
// carry a URL. Those are the highest-value leads in the pipeline
// (just_funded), and without this step every one of them was dropped.
//
// Method: generate the domains startups actually use for a name (acme.com,
// acme.io, getacme.com, acme.ai, acmehq.com, …), keep the ones that resolve
// in DNS, then load each and accept it only if the site's own title or text
// names the company. A guess that isn't confirmed on the page is discarded:
// a wrong domain would mean emailing a stranger.

const TLDS = ["com", "io", "ai", "in", "co", "app", "tech", "co.in"];
const PREFIXES = ["get", "try", "use"];
const SUFFIXES = ["hq", "app"];
const CORP_WORDS = /\b(inc|llc|ltd|limited|pvt|private|technologies|technology|labs|corp|corporation|co|group|holdings)\b\.?/gi;

export function nameSlugs(name = "") {
  const clean = name.toLowerCase().replace(/['’]s\b/g, "").replace(CORP_WORDS, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const slugs = new Set([words.join(""), words.join("-")]);
  if (words.length > 1 && words[0].length >= 4) slugs.add(words[0]);
  return [...slugs].filter((s) => s.length >= 3 && s.length <= 40);
}

export function candidateDomains(name) {
  const out = [];
  for (const slug of nameSlugs(name)) {
    for (const tld of TLDS) out.push(`${slug}.${tld}`);
    for (const p of PREFIXES) out.push(`${p}${slug}.com`);
    for (const x of SUFFIXES) out.push(`${slug}${x}.com`);
  }
  return [...new Set(out)];
}

// The page must name the company: compact name in the title, or the full
// name in the visible text.
export function pageNamesCompany(name, { title = "", textSample = "" }) {
  const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const core = compact(name.replace(CORP_WORDS, " "));
  if (core.length < 3) return false;
  if (compact(title).includes(core)) return true;
  return compact(textSample.slice(0, 1500)).includes(core);
}

async function resolves(host) {
  const ok = await Promise.race([
    dns.resolve4(host).then((a) => a.length > 0).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 4000)),
  ]);
  return ok;
}

export async function resolveWebsite(name, { maxChecks = 6 } = {}) {
  const domains = candidateDomains(name);
  const live = [];
  // DNS is cheap: check every candidate, in parallel.
  const checks = await Promise.all(domains.map(async (d) => ((await resolves(d)) ? d : null)));
  for (const d of checks) if (d) live.push(d);

  for (const domain of live.slice(0, maxChecks)) {
    // eslint-disable-next-line no-await-in-loop
    const site = await verifySite(domain);
    if (site.ok && pageNamesCompany(name, site)) return { website: `https://${domain}`, site };
  }
  return null;
}
