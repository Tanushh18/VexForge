import axios from "axios";

// r/startups and r/SaaS launch/feedback threads — founders posting their own
// product, usually with a link and a description in the same post. Uses
// Reddit's public JSON API (append .json to any listing URL, no auth, no
// scraping): the same "official endpoint over parsed HTML" approach as the
// HN source, so this needs no browser and is no riskier to run than a plain
// HTTP call.
//
// Confirmed by a real diagnostic run: Reddit returns 403 on every request
// from a GitHub Actions runner specifically — this is Reddit blocking known
// datacenter/cloud IP ranges, not a bug in this code or a wrong endpoint.
// The same request works fine from a residential IP (a laptop, a home
// server), so this source is fully functional running on the local worker;
// it just can't be relied on from a CI runner the way the other direct-fetch
// sources can. Left registered rather than removed — it's real and valuable
// wherever it can actually reach Reddit.

const SUBREDDITS = ["startups", "SaaS", "EntrepreneurRideAlong"];
const PLATFORM_HOSTS = [
  "reddit.com", "redd.it", "i.redd.it", "v.redd.it", "imgur.com",
  "github.com", "twitter.com", "x.com", "youtube.com", "youtu.be",
];

// Posts that read as a launch/feedback ask rather than a discussion thread —
// this is a founder announcing something, not someone asking "how do I..."
const LAUNCH_PATTERN = /\b(launch(ed|ing)?|just (shipped|released|built)|check out|feedback on|i built|we built|made this)\b/i;

export function isUsableCompanyUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return !PLATFORM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Reddit truncates nothing structurally, but titles are free text with no
// company-name convention the way "Launch HN: X —" is — so the post title
// itself becomes the company name candidate, cleaned of launch-phrase noise.
export function cleanTitle(title = "") {
  return title
    .replace(/^(i built|we built|made this|launching|launched|just shipped|just released)\s*:?\s*/i, "")
    .replace(/[-–—]\s*(feedback|thoughts|check it out).*/i, "")
    .trim()
    .slice(0, 120);
}

export async function fetchRedditLaunches({ limit = 15, sinceDays = 14 } = {}) {
  const sinceSec = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const leads = [];

  for (const sub of SUBREDDITS) {
    if (leads.length >= limit) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await axios.get(`https://www.reddit.com/r/${sub}/new.json`, {
        timeout: 15000,
        params: { limit: 50 },
        headers: { "User-Agent": "VexForgeLeadScout/1.0 (+B2B lead discovery; low volume)" },
      });

      for (const child of data?.data?.children || []) {
        if (leads.length >= limit) break;
        const post = child.data;
        if (!post || post.created_utc < sinceSec) continue;
        if (post.is_self) continue; // self-posts have no product link
        if (!LAUNCH_PATTERN.test(post.title || "")) continue;
        if (!isUsableCompanyUrl(post.url)) continue;

        const name = cleanTitle(post.title);
        if (!name) continue;

        leads.push({
          companyName: name,
          website: post.url,
          notes: post.selftext ? post.selftext.slice(0, 400) : undefined,
          sourceUrl: `https://reddit.com${post.permalink}`,
          discoveredAt: new Date(post.created_utc * 1000),
          signals: ["just_launched"],
        });
      }
    } catch (err) {
      // One subreddit failing (rate limit, temporary 403) shouldn't drop the
      // others — safeSource() in index.js catches at the source level, but a
      // per-subreddit try/catch here keeps one bad fetch from losing the rest.
      console.error(`[reddit_launches] r/${sub} failed:`, err.message);
    }
  }

  return leads;
}

export default { key: "reddit_launches", label: "Reddit launches (r/startups, r/SaaS)", needsBrowser: false, run: fetchRedditLaunches };
