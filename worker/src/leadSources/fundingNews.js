import axios from "axios";
import * as cheerio from "cheerio";

// Recent funding announcements via Google News' public RSS search — no API
// key, no scraping of a page that could change its markup, just an RSS feed
// Google has kept stable for years. Same "official-ish endpoint over parsed
// HTML" shape as the HN and Reddit sources: no browser needed.
//
// Honest limitation: a news headline gives a company NAME and a funding
// signal, but essentially never a usable website URL — "Acme raises $2M"
// doesn't tell you acme.example vs acme.io vs getacme.com. So leads from this
// source carry no `website`, which means the enrichment step has nothing to
// scrape and they land with the no_contact_path penalty until you (or the
// static/deep scan on the Leads or Admin page) find the domain by hand. That
// trade-off is still worth it: `just_funded` is the single highest-weighted
// signal in scoring, and these are real, current funding events a search-only
// source would otherwise never surface.

const FEED = "https://news.google.com/rss/search";

// Google News titles are "<headline> - <publisher>"; the publisher segment is
// stripped before parsing. Indian funding coverage favours "raises/secures/
// bags/lands ... funding", which is what the query below is built to surface.
const FUNDING_VERBS = "raises|secures|bags|lands|closes|nets|garners";
const NAME_PATTERN = new RegExp(`^(.{2,60}?)\\s+(?:${FUNDING_VERBS})\\b`, "i");

export function stripPublisher(title = "") {
  const idx = title.lastIndexOf(" - ");
  return idx > 0 ? title.slice(0, idx).trim() : title.trim();
}

// Headlines wrap the name in descriptors — "AI startup Mantic raises…",
// "Portland startup Antfly bags…", "Five months old, Noetive lands…". The
// name is what's left after the last comma and after any leading
// "<adjectives> startup/firm/platform/maker" phrase. Getting this right
// matters twice over: the name is the lead, and it is what the website
// resolver searches on.
const DESCRIPTOR = /^.*?\b(?:startup|start-up|firm|company|platform|maker|brand|venture|unicorn|saas|app)\s+/i;

export function cleanCompanyName(rawName = "") {
  let name = rawName.trim();
  const comma = name.lastIndexOf(",");
  if (comma > 0 && comma < name.length - 2) name = name.slice(comma + 1).trim();
  const stripped = name.replace(DESCRIPTOR, "").trim();
  // Only accept the strip if something plausible is left.
  if (stripped.length >= 2 && /[a-z]/i.test(stripped)) name = stripped;
  return name.replace(/^(the|a|an)\s+/i, "").replace(/\s+/g, " ").trim();
}

export function parseFundingTitle(rawTitle = "") {
  const title = stripPublisher(rawTitle);
  const match = NAME_PATTERN.exec(title);
  if (!match) return null;
  const name = cleanCompanyName(match[1]);
  // A regex match that swallowed most of the headline (no room left for an
  // amount/round) usually means it matched something that wasn't a company
  // name — better to skip than to create a garbage lead.
  if (name.length < 2 || name.length > 60) return null;
  return { name, description: title };
}

export async function fetchFundingNews({ limit = 15, sinceDays = 7, query, region = "IN" } = {}) {
  const q = query || `(startup) (${FUNDING_VERBS.split("|").join(" OR ")}) (seed OR "series a" OR funding) when:${sinceDays}d`;
  const { data } = await axios.get(FEED, {
    timeout: 15000,
    params: region === "IN" ? { q, hl: "en-IN", gl: "IN", ceid: "IN:en" } : { q, hl: "en-US", gl: "US", ceid: "US:en" },
    headers: { "User-Agent": "VexForgeLeadScout/1.0 (+B2B lead discovery; low volume)" },
  });

  const $ = cheerio.load(data, { xmlMode: true });
  const leads = [];
  const seenNames = new Set();

  $("item").each((_, el) => {
    if (leads.length >= limit) return;
    const title = $(el).find("title").first().text();
    const link = $(el).find("link").first().text();
    const pubDate = $(el).find("pubDate").first().text();

    const parsed = parseFundingTitle(title);
    if (!parsed) return;

    const key = parsed.name.toLowerCase();
    if (seenNames.has(key)) return; // multiple outlets often cover the same round
    seenNames.add(key);

    leads.push({
      companyName: parsed.name,
      // No `website` here — the pipeline's resolver (resolveWebsite.js)
      // guesses the domain from the name and confirms it on the live site.
      notes: parsed.description,
      sourceUrl: link || undefined,
      discoveredAt: pubDate ? new Date(pubDate) : new Date(),
      signals: ["just_funded"],
    });
  });

  return leads;
}

export default { key: "funding_news", label: "Funding news (Google News search)", needsBrowser: false, run: fetchFundingNews };

// Same feed, US/global edition: different outlets, different rounds.
export const fundingNewsGlobal = {
  key: "funding_news_global",
  label: "Funding news — global (Google News, US edition)",
  needsBrowser: false,
  run: (opts = {}) => fetchFundingNews({ ...opts, region: "US" }),
};
