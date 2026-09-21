import axios from "axios";

// Hacker News "Launch HN" / "Show HN" posts — startups announcing themselves,
// usually within days of going live. Uses the public Algolia search API that
// HN documents for exactly this purpose, so there is no scraping and no
// browser: an official JSON endpoint is both politer and far more stable than
// parsing news.ycombinator.com's markup.

const API = "https://hn.algolia.com/api/v1/search_by_date";
const PLATFORM_HOSTS = ["ycombinator.com", "news.ycombinator.com", "github.com", "twitter.com", "x.com", "medium.com", "notion.site"];

// "Launch HN: Acme (YC W24) — AI for dentists" → { name, description }
export function parseLaunchTitle(title = "") {
  const stripped = title.replace(/^(Launch HN|Show HN|Ask HN)\s*:\s*/i, "").trim();
  const [namePart, ...rest] = stripped.split(/\s+[—–-]\s+/);
  let name = (namePart || stripped).trim();
  const batch = name.match(/\((YC\s+[SWFX]\d{2})\)/i);
  name = name.replace(/\s*\((YC\s+[SWFX]\d{2})\)\s*/i, " ").replace(/\s+/g, " ").trim();
  return {
    name,
    description: rest.join(" - ").trim() || null,
    ycBatch: batch ? batch[1].toUpperCase() : null,
  };
}

export function isUsableCompanyUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return !PLATFORM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function fetchHnLaunches({ limit = 20, sinceDays = 14 } = {}) {
  const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const { data } = await axios.get(API, {
    timeout: 15000,
    params: {
      query: "Launch HN",
      tags: "story",
      numericFilters: `created_at_i>${since}`,
      hitsPerPage: Math.min(limit * 3, 100), // over-fetch: many hits have no usable outbound URL
    },
  });

  const leads = [];
  for (const hit of data.hits || []) {
    if (!/^(Launch|Show) HN/i.test(hit.title || "")) continue;
    const { name, description, ycBatch } = parseLaunchTitle(hit.title);
    if (!name) continue;
    if (!isUsableCompanyUrl(hit.url)) continue;

    // A YC batch tag is public confirmation the company took money, which is
    // the same buying signal as a funding announcement.
    const signals = ["just_launched"];
    if (ycBatch) signals.push("just_funded");

    leads.push({
      companyName: name,
      website: hit.url,
      notes: [description, ycBatch].filter(Boolean).join(" · ") || undefined,
      sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      discoveredAt: hit.created_at ? new Date(hit.created_at) : new Date(),
      signals,
    });
    if (leads.length >= limit) break;
  }
  return leads;
}

export default { key: "hn_launches", label: "Hacker News launches", needsBrowser: false, run: fetchHnLaunches };
