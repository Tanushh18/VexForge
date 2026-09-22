import axios from "axios";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import { normalizeUrl, assertPublicHost } from "./scraper.js";

// Lead verification. A lead only reaches the CRM once it has proven, from
// the live internet, that it is a real, operating company we can actually
// reach:
//
//   1. verifySite   the website loads (2xx), is not parked / for sale / a
//                   dead placeholder, and is not someone else's platform page.
//   2. verifyEmail  the address is well-formed, not disposable or no-reply,
//                   and its domain has mail servers (MX) that can receive it.
//
// Both also collect *conversion* evidence (fresh domain, outdated site, a
// real person's inbox, email on the company's own domain) that feeds the
// deterministic score in shared/scoring.js. No model is involved: every
// check is a fact observed on the network, reproducible and explainable.

const SITE_TIMEOUT_MS = 10000;
const USER_AGENT = "Mozilla/5.0 (compatible; VexForgeBot/1.0; +lead verification)";

// Hosts that mean "this domain is parked or for sale", seen as the final
// redirect target.
const PARKING_HOSTS = [
  "sedo.com", "dan.com", "afternic.com", "hugedomains.com", "bodis.com", "parkingcrew.net",
  "above.com", "undeveloped.com", "godaddy.com", "namecheap.com", "domainmarket.com", "sav.com",
];

const PARKED_TEXT = [
  "this domain is for sale", "domain is for sale", "buy this domain", "this domain may be for sale",
  "domain has expired", "domain name has expired", "parked free", "parked domain",
  "is parked", "website is under construction", "account has been suspended", "account suspended",
  "default web page", "welcome to nginx", "apache2 ubuntu default page", "it works!",
  "future home of something quite cool",
];

// A site whose final URL lands on one of these is a profile page, not the
// company's own website.
const PROFILE_HOSTS = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "producthunt.com",
  "github.com", "medium.com", "notion.site", "linktr.ee", "carrd.co", "youtube.com",
];

const PRELAUNCH_TEXT = ["coming soon", "launching soon", "join the waitlist", "join our waitlist", "notify me"];

// Free mailbox providers: reachable, but a weaker sign than an address on the
// company's own domain.
const FREE_MAIL = [
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "proton.me", "protonmail.com", "aol.com", "zoho.com", "yandex.com", "gmx.com",
];

const DISPOSABLE_MAIL = [
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
];

const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|abuse|webmaster)@/i;
const ROLE_INBOX = /^(info|hello|hi|contact|support|help|admin|sales|team|office|enquiries|inquiries|mail|general)@/i;
const EMAIL_SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
// Image names like "logo@2x.png" match the email regex in the scraper.
const ASSET_TLD = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

export function hostOf(url) {
  try {
    return new URL(normalizeUrl(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The registrable domain, approximately (last two labels, three for the
// common country second-levels like co.in / co.uk). Good enough to compare
// an email's domain with a website's.
export function baseDomain(host) {
  const parts = (host || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2];
  const take = ["co", "com", "net", "org", "gov", "ac", "edu"].includes(sld) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-take).join(".");
}

function hostMatches(host, list) {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

// Pure: judges already-fetched HTML. Separated from the fetch so it can be
// tested without a network.
export function assessSiteContent({ html = "", finalUrl = "", status = 0, now = new Date() }) {
  const finalHost = hostOf(finalUrl);
  const result = { ok: false, reason: null, signals: [], title: "", finalHost };

  if (status < 200 || status >= 400) return { ...result, reason: `http_${status || "error"}` };
  if (hostMatches(finalHost, PARKING_HOSTS)) return { ...result, reason: "parked_redirect" };
  if (hostMatches(finalHost, PROFILE_HOSTS)) return { ...result, reason: "not_own_site" };

  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const title = $("title").first().text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const lower = `${title} ${text}`.toLowerCase();
  result.title = title.slice(0, 200);
  result.textSample = text.slice(0, 3000);

  if (PARKED_TEXT.some((p) => lower.includes(p))) return { ...result, reason: "parked_or_placeholder" };

  // A JS-rendered app can ship almost no text in its HTML — still a live
  // site if it has a real <title> and mounts an app root.
  const isSpa = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html);
  if (text.length < 150 && !(isSpa && title)) return { ...result, reason: "empty_page" };

  if (PRELAUNCH_TEXT.some((p) => lower.includes(p)) && text.length < 1500) result.signals.push("prelaunch");

  // An old copyright year is a cue the site hasn't been touched in a while —
  // for a studio that builds web products, that is an opening, not a flaw.
  const years = [...lower.matchAll(/(?:©|copyright|&copy;)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/g)].map((m) => Number(m[1]));
  if (years.length && Math.max(...years) <= now.getFullYear() - 2) result.signals.push("outdated_site");

  const rawLower = html.toLowerCase();
  if (/wp-content|wix\.com|squarespace|weebly|jimdo/.test(rawLower)) result.signals.push("site_builder");
  if (/(pricing|sign\s?up|get started|book a demo|free trial|start free)/.test(lower)) result.signals.push("active_product");
  if (!finalUrl.startsWith("https://")) result.signals.push("no_https");

  return { ...result, ok: true };
}

export async function verifySite(website, { timeoutMs = SITE_TIMEOUT_MS } = {}) {
  const url = normalizeUrl(website);
  try {
    await assertPublicHost(new URL(url).hostname);
  } catch (err) {
    return { ok: false, reason: "dns_unresolved", detail: err.message, signals: [] };
  }

  const get = (target) =>
    axios.get(target, {
      timeout: timeoutMs,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: () => true,
      maxContentLength: 3 * 1024 * 1024,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });

  let res;
  try {
    res = await get(url);
  } catch {
    // Some small-company sites still have no valid certificate.
    try {
      res = await get(url.replace(/^https:/, "http:"));
    } catch (err) {
      return { ok: false, reason: "unreachable", detail: err.code || err.message, signals: [] };
    }
  }

  const finalUrl = res.request?.res?.responseUrl || url;
  // Bot walls (Cloudflare 403/503) mean "we couldn't look", not "dead". Count
  // it live but unverified-content so a real company isn't thrown away.
  if ([403, 429, 503].includes(res.status) && /cloudflare|captcha|challenge/i.test(String(res.data).slice(0, 5000))) {
    return { ok: true, reason: null, signals: ["bot_protected"], finalHost: hostOf(finalUrl), title: "" };
  }
  return assessSiteContent({ html: String(res.data || ""), finalUrl, status: res.status });
}

async function withTimeout(promise, ms, fallback) {
  return Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

// Pure part of email verification: shape, blocklists and domain relations.
export function assessEmailShape(email, website) {
  const addr = (email || "").trim().toLowerCase();
  const out = { ok: false, reason: null, signals: [], email: addr };
  if (!EMAIL_SHAPE.test(addr) || ASSET_TLD.test(addr)) return { ...out, reason: "malformed" };
  if (NO_REPLY.test(addr)) return { ...out, reason: "no_reply" };

  const domain = addr.split("@")[1];
  if (hostMatches(domain, DISPOSABLE_MAIL)) return { ...out, reason: "disposable" };

  if (hostMatches(domain, FREE_MAIL)) out.signals.push("free_mail");
  else if (website && baseDomain(domain) === baseDomain(hostOf(website))) out.signals.push("email_on_company_domain");
  else out.signals.push("email_off_domain");

  out.signals.push(ROLE_INBOX.test(addr) ? "role_inbox" : "personal_inbox");
  return { ...out, ok: true, domain };
}

export async function verifyEmail(email, website) {
  const shape = assessEmailShape(email, website);
  if (!shape.ok) return shape;
  if (shape.signals.includes("free_mail")) return shape; // big providers always accept mail

  const mx = await withTimeout(dns.resolveMx(shape.domain), 5000, []);
  if (mx.length) return { ...shape, mx: mx.sort((a, b) => a.priority - b.priority)[0].exchange };
  // RFC 5321 fallback: no MX but an A record can still receive mail.
  const a = await withTimeout(dns.resolve4(shape.domain), 5000, []);
  if (a.length) return { ...shape, mx: shape.domain };
  return { ...shape, ok: false, reason: "no_mail_server" };
}

// Tries each email the enricher found, best first, and returns the first one
// that verifies. Prefers a person's inbox on the company's own domain.
export async function pickVerifiedEmail(emails, website) {
  const rank = (e) => {
    const s = assessEmailShape(e, website).signals;
    return (s.includes("email_on_company_domain") ? 0 : s.includes("free_mail") ? 2 : 1) * 2 + (s.includes("personal_inbox") ? 0 : 1);
  };
  const ordered = [...new Set(emails)].sort((a, b) => rank(a) - rank(b));
  const rejected = [];
  for (const e of ordered) {
    // eslint-disable-next-line no-await-in-loop
    const v = await verifyEmail(e, website);
    if (v.ok) return { ...v, rejected };
    rejected.push({ email: e, reason: v.reason });
  }
  return { ok: false, reason: rejected.length ? "no_valid_email" : "no_email", rejected, signals: [] };
}

// Registration date via RDAP (the free, public successor to WHOIS). A domain
// under a year old is a company that is still choosing its vendors. Any
// failure just means "unknown" — never a reason to drop a lead.
export async function domainAgeDays(host, { now = Date.now() } = {}) {
  const domain = baseDomain(host);
  if (!domain) return null;
  try {
    const res = await axios.get(`https://rdap.org/domain/${domain}`, { timeout: 6000, headers: { Accept: "application/rdap+json" } });
    const reg = (res.data?.events || []).find((e) => e.eventAction === "registration");
    if (!reg?.eventDate) return null;
    return Math.floor((now - new Date(reg.eventDate).getTime()) / 86400000);
  } catch {
    return null;
  }
}

// Collapses the same company arriving from several sources into one lead.
// Being listed in more than one place (e.g. launched on Product Hunt AND
// covered in funding news) is itself strong evidence the company is real and
// active, so the merge records it as a signal.
export function mergeBySite(leads) {
  const byKey = new Map();
  const out = [];
  for (const lead of leads) {
    const key = lead.website ? baseDomain(hostOf(lead.website)) : `name:${(lead.companyName || "").trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      const copy = { ...lead, signals: [...(lead.signals || [])], seenIn: [lead.discoverySource].filter(Boolean) };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    for (const s of lead.signals || []) if (!existing.signals.includes(s)) existing.signals.push(s);
    if (lead.discoverySource && !existing.seenIn.includes(lead.discoverySource)) existing.seenIn.push(lead.discoverySource);
    existing.notes = existing.notes || lead.notes;
    existing.contactName = existing.contactName || lead.contactName;
    existing.website = existing.website || lead.website;
  }
  for (const l of out) if (l.seenIn.length > 1 && !l.signals.includes("multi_source")) l.signals.push("multi_source");
  return out;
}

// Small bounded-concurrency map: different hosts in parallel (each gets one
// request), without opening hundreds of sockets at once.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
