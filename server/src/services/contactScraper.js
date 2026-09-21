import axios from "axios";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";

// The static half of contact lookup: a plain HTTP GET of a company's OWN
// public pages, looking for a mailto: link or a published address.
//
// The browser-driven tier that used to live alongside this now lives on the
// local worker (worker/src/scraper.js), because Chromium costs ~730MB and the
// deployed server is sized for a 140MB Node process. This file deliberately
// has no Playwright import — that's what keeps the server's Docker image
// small and its memory ceiling predictable.
//
// Deliberately narrow either way: no LinkedIn, no directories, nothing
// requiring a login. Just the homepage and the likely contact/about pages of
// a domain you point it at, so sourcing stays "the company published this
// address themselves".

const CANDIDATE_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us"];
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SKIP_DOMAINS = ["example.com", "sentry.io", "wixpress.com", "godaddy.com"];

export function normalizeUrl(domainOrUrl) {
  let url = domainOrUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/$/, "");
}

// A scan target is user-supplied text, so refuse anything resolving to a
// private/loopback/link-local address — the last of which also covers cloud
// metadata endpoints like 169.254.169.254.
export function isPrivateIp(ip) {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
}

export async function assertPublicHost(hostname) {
  if (hostname === "localhost") throw new Error(`Refusing to scan "${hostname}" — not a public host`);
  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
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
      // eslint-disable-next-line no-await-in-loop
      const res = await axios.get(target, {
        timeout: timeoutMs,
        headers: { "User-Agent": "VexForgeLeadScout/1.0 (+contact lookup for B2B outreach)" },
        validateStatus: (s) => s < 500,
      });
      if (res.status >= 200 && res.status < 400 && typeof res.data === "string") {
        results.pagesOk.push(target);
        for (const e of extractEmails(res.data)) if (!results.emails.includes(e)) results.emails.push(e);
      }
    } catch (err) {
      // Non-fatal — a single dead path shouldn't kill the whole scan.
      results.error = results.error || err.message;
    }
    if (results.emails.length >= 3) break; // enough signal, stop hammering the site
  }

  return results;
}
