import axios from "axios";
import { isUsableCompanyUrl } from "./hnLaunches.js";

// "Ask HN: Who is hiring?" — the monthly thread where companies post their
// own openings (the rules forbid recruiters and job boards, so every
// top-level comment is a company speaking for itself). A startup hiring
// engineers is short on build capacity right now, which is exactly the gap a
// studio fills. Public Algolia API, no browser, not blocked from CI runners.

const SEARCH = "https://hn.algolia.com/api/v1/search_by_date";
const ITEM = "https://hn.algolia.com/api/v1/items";

// Big, well-known employers post here too; they are not a two-person
// studio's clients.
const TOO_LARGE = /\b(google|amazon|microsoft|apple|meta|netflix|stripe|airbnb|uber|coinbase|datadog|cloudflare|shopify)\b/i;

function decode(html = "") {
  return html
    .replace(/<p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x2F;/g, "/").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Convention: "Acme | Senior Engineer | Remote | https://acme.io". Returns
// null for a comment that doesn't follow it well enough to trust.
export function parseHiringComment(html = "") {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]));
  const text = decode(html);
  const firstLine = text.split("\n")[0].trim();
  const parts = firstLine.split(/\s+\|\s+/);
  if (parts.length < 2) return null;
  const name = parts[0].replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 50 || /^(https?:|www\.)/i.test(name)) return null;

  const inline = firstLine.match(/https?:\/\/[^\s|)]+/g) || [];
  const website = [...inline, ...hrefs].map((u) => u.replace(/[.,;]+$/, "")).find((u) => {
    if (!isUsableCompanyUrl(u)) return false;
    // Skip ATS pages; the company's own domain is what we want.
    return !/(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|bamboohr\.com|breezy\.hr|recruitee\.com|wellfound\.com|angel\.co|forms\.gle|docs\.google\.com)/i.test(u);
  });
  return { name, website: website || null, description: firstLine.slice(0, 300) };
}

export async function fetchHnHiring({ limit = 15 } = {}) {
  const { data: search } = await axios.get(SEARCH, {
    timeout: 15000,
    params: { query: "Who is hiring", tags: "story,author_whoishiring", hitsPerPage: 5 },
  });
  const thread = (search.hits || []).find((h) => /who is hiring/i.test(h.title || ""));
  if (!thread) return [];

  const { data: item } = await axios.get(`${ITEM}/${thread.objectID}`, { timeout: 20000 });
  const leads = [];
  // Newest comments first: late posters are often the smaller companies.
  const comments = (item.children || []).filter((c) => c.text).sort((a, b) => (b.created_at_i || 0) - (a.created_at_i || 0));
  for (const c of comments) {
    const parsed = parseHiringComment(c.text);
    if (!parsed || TOO_LARGE.test(parsed.name)) continue;
    leads.push({
      companyName: parsed.name,
      website: parsed.website || undefined,
      notes: parsed.description,
      sourceUrl: `https://news.ycombinator.com/item?id=${c.id}`,
      discoveredAt: c.created_at ? new Date(c.created_at) : new Date(),
      signals: ["hiring"],
    });
    if (leads.length >= limit) break;
  }
  return leads;
}

export default { key: "hn_hiring", label: "HN Who's Hiring — startups hiring engineers now", needsBrowser: false, run: fetchHnHiring };
