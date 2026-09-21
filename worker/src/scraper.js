import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import dns from "node:dns/promises";

// Finds a publicly-posted contact email on a company's OWN website. This is
// deliberately narrow: it does not crawl LinkedIn, directories, or anything
// requiring a login — just the homepage + likely contact/about pages of a
// domain you point it at, looking for a mailto: link or a plain email in
// the text. That keeps sourcing to "the company published this email
// themselves," which is the lowest-risk lead-gen technique available.
//
// Every result lands in the Lead collection at stage "new" — nothing is
// emailed until a human drafts, reviews, and approves an OutreachMessage.

const CANDIDATE_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us"];
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SKIP_DOMAINS = ["example.com", "sentry.io", "wixpress.com", "godaddy.com"];

function normalizeUrl(domainOrUrl) {
  let url = domainOrUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/$/, "");
}

// A scan target is admin-supplied text, and the deep tier drives a full
// browser (JS execution, redirects) rather than a plain HTTP GET — refuse
// anything that resolves to a private/loopback/link-local address (the
// latter also covers cloud metadata endpoints like 169.254.169.254).
export function isPrivateIp(ip) {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
}

async function assertPublicHost(hostname) {
  if (hostname === "localhost") throw new Error(`Refusing to scan "${hostname}" — not a public host`);
  // dns.lookup() has no built-in timeout and can hang far longer than any
  // HTTP client timeout on a bad resolver path — bound it explicitly so one
  // unresolvable domain can't stall the whole enrichment loop.
  const records = await Promise.race([
    dns.lookup(hostname, { all: true }).catch(() => []),
    new Promise((resolve) => setTimeout(() => resolve([]), 5000)),
  ]);
  if (!records.length) throw new Error(`Could not resolve "${hostname}"`);
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error(`Refusing to scan "${hostname}" — resolves to a private/internal address`);
  }
}

export function extractEmails(html) {
  const $ = cheerio.load(html);
  const found = new Set();

  $("a[href^='mailto:']").each((_, el) => {
    const addr = $(el).attr("href").replace(/^mailto:/i, "").split("?")[0].trim();
    if (addr) found.add(addr.toLowerCase());
  });

  // Tag-strip with a space separator rather than cheerio's .text(), which
  // concatenates adjacent elements' text with nothing between them — on
  // minified real-world HTML that fuses e.g. "Email"+"hi@acme.example" into
  // one bogus token the regex reads as a single (wrong) email address.
  const bodyHtml = $("body").html() || "";
  const text = bodyHtml.replace(/<[^>]+>/g, " ");
  const matches = text.match(EMAIL_RE) || [];
  for (const m of matches) found.add(m.toLowerCase());

  return [...found].filter((e) => !SKIP_DOMAINS.some((d) => e.endsWith(`@${d}`) || e.endsWith(`.${d}`)));
}

export async function scrapeCompanyContact(domainOrUrl, { timeoutMs = 8000 } = {}) {
  const base = normalizeUrl(domainOrUrl);
  await assertPublicHost(new URL(base).hostname);
  const results = { website: base, emails: [], pagesTried: [], pagesOk: [], error: null };

  for (const path of CANDIDATE_PATHS) {
    const target = `${base}${path}`;
    results.pagesTried.push(target);
    try {
      const res = await axios.get(target, {
        timeout: timeoutMs,
        headers: { "User-Agent": "VexForgeLeadScout/1.0 (+contact lookup for B2B outreach)" },
        validateStatus: (s) => s < 500,
      });
      if (res.status >= 200 && res.status < 400 && typeof res.data === "string") {
        results.pagesOk.push(target);
        const emails = extractEmails(res.data);
        for (const e of emails) if (!results.emails.includes(e)) results.emails.push(e);
      }
    } catch (err) {
      // Non-fatal — a single dead path shouldn't kill the whole scan.
      results.error = results.error || err.message;
    }
    if (results.emails.length >= 3) break; // enough signal, stop hammering the site
  }

  return results;
}

// Tier 2: a real headless browser (Playwright/Chromium), for sites that
// render their contact info with JS and give Cheerio nothing to parse.
// Meant to be triggered deliberately (the Admin page's "deep scan"), not
// run for every lead — a full browser per domain is far more expensive
// than a plain GET.
export async function scrapeCompanyContactDeep(domainOrUrl, { timeoutMs = 15000 } = {}) {
  const base = normalizeUrl(domainOrUrl);
  await assertPublicHost(new URL(base).hostname);
  const results = { website: base, emails: [], pagesTried: [], pagesOk: [], error: null };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "VexForgeLeadScout/1.0 (+deep contact lookup for B2B outreach)",
    });
    // Skip heavy assets — we only need the rendered DOM text/links.
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();

    for (const path of CANDIDATE_PATHS) {
      const target = `${base}${path}`;
      results.pagesTried.push(target);
      try {
        const res = await page.goto(target, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
        if (res && res.ok()) {
          results.pagesOk.push(target);
          const html = await page.content();
          for (const e of extractEmails(html)) if (!results.emails.includes(e)) results.emails.push(e);
        }
      } catch (err) {
        results.error = results.error || err.message;
      }
      if (results.emails.length >= 3) break;
    }
  } finally {
    await browser.close();
  }
  return results;
}

// What the Admin "deep scan" trigger actually calls: try the cheap static
// pass first, only pay for a browser if that came back empty.
export async function scrapeCompanyContactTiered(domainOrUrl, opts = {}) {
  const fast = await scrapeCompanyContact(domainOrUrl, opts);
  if (fast.emails.length > 0) return { ...fast, tier: "static" };
  const deep = await scrapeCompanyContactDeep(domainOrUrl, opts);
  return { ...deep, tier: "browser" };
}

export async function scrapeManyDomains(domains) {
  const out = [];
  for (const d of domains) {
    // Sequential + no retries by design: a lead-gen crawler should be a
    // polite, low-volume citizen of the sites it visits, not a scraper farm.
    // eslint-disable-next-line no-await-in-loop
    const r = await scrapeCompanyContact(d);
    out.push(r);
  }
  return out;
}
