import { cleanOutboundUrl, isPlatformDomain } from "./browser.js";

// A single, reusable Playwright adapter for "listing page full of outbound
// links to other companies' sites" — which is what a launch board, a startup
// directory, or a job board's company list all reduce to structurally. Rather
// than writing bespoke CSS-selector scrapers per site (fragile, and every one
// would be unverified against the live page from here — this sandbox has no
// outbound network), this harvests every <a href> on the page, keeps the ones
// that point off-platform, and pairs each with its link text as a company-name
// candidate. That's the same technique already proven in productHunt.js and
// ycDirectory.js (match by URL/href shape, not by a specific class name), just
// generalized so one well-tested extractor backs many site configs instead of
// N separately-fragile ones.
//
// Cost of the generalization: no per-site description scraping, and the
// "company name" is whatever text the site itself put on the link — usually
// fine (that's literally the product name on a launch board), occasionally
// noisy (nav links, "Visit site" buttons). isLikelyCompanyName() below is the
// one filter standing between this and junk.

const GENERIC_NOISE_HOSTS = [
  "twitter.com", "x.com", "facebook.com", "linkedin.com", "instagram.com",
  "youtube.com", "youtu.be", "github.com", "discord.com", "discord.gg",
  "medium.com", "notion.site", "t.me", "wa.me", "apps.apple.com", "play.google.com",
];

// Link text that isn't a company name — UI chrome, not a product.
const NOISE_TEXT = /^(visit|website|home|sign\s*up|log\s*in|learn more|read more|get started|try it|view|open|link|↗|→|»)$/i;

export function isLikelyCompanyName(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.length < 2 || t.length > 80) return false;
  if (NOISE_TEXT.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false; // the link text was just the URL itself
  return true;
}

// Pure and testable without a browser: given the {href, text} pairs a page
// yielded, produce deduped {companyName, website} candidates.
export function extractDirectoryLeads(pairs, extraPlatformHosts = []) {
  const platformHosts = [...GENERIC_NOISE_HOSTS, ...extraPlatformHosts];
  const seen = new Set();
  const out = [];

  for (const { href, text } of pairs) {
    const website = cleanOutboundUrl(href);
    if (!website || isPlatformDomain(website, platformHosts)) continue;

    let domain;
    try {
      domain = new URL(website).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seen.has(domain)) continue;

    if (!isLikelyCompanyName(text)) continue;
    seen.add(domain);
    out.push({ companyName: text.trim(), website });
  }

  return out;
}

export async function harvestDirectory(context, { url, platformHosts = [], limit = 15, waitForSelector, timeoutMs = 25000 } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    if (waitForSelector) await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
    else await page.waitForTimeout(1500); // let a client-rendered listing hydrate

    const pairs = await page.$$eval("a[href]", (els) =>
      els.map((e) => ({ href: e.getAttribute("href"), text: (e.textContent || "").trim() }))
    );

    return extractDirectoryLeads(pairs, platformHosts).slice(0, limit);
  } finally {
    await page.close();
  }
}

// Turns one site config into a standard source module — same {key, label,
// needsBrowser, run} shape every source in the registry uses.
export function makeDirectorySource({ key, label, url, platformHosts, signals = ["just_launched"], waitForSelector }) {
  return {
    key,
    label,
    needsBrowser: true,
    async run(context, { limit = 15 } = {}) {
      const found = await harvestDirectory(context, { url, platformHosts, limit, waitForSelector });
      return found.map((lead) => ({ ...lead, signals: [...signals] }));
    },
  };
}
