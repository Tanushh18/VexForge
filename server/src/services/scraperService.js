import axios from "axios";
import * as cheerio from "cheerio";

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

function extractEmails(html) {
  const $ = cheerio.load(html);
  const found = new Set();

  $("a[href^='mailto:']").each((_, el) => {
    const addr = $(el).attr("href").replace(/^mailto:/i, "").split("?")[0].trim();
    if (addr) found.add(addr.toLowerCase());
  });

  const text = $("body").text();
  const matches = text.match(EMAIL_RE) || [];
  for (const m of matches) found.add(m.toLowerCase());

  return [...found].filter((e) => !SKIP_DOMAINS.some((d) => e.endsWith(`@${d}`) || e.endsWith(`.${d}`)));
}

export async function scrapeCompanyContact(domainOrUrl, { timeoutMs = 8000 } = {}) {
  const base = normalizeUrl(domainOrUrl);
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
