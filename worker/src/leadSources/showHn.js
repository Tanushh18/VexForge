import axios from "axios";
import { parseLaunchTitle, isUsableCompanyUrl } from "./hnLaunches.js";

// "Show HN" posts: founders and indie makers showing a product they just
// shipped. Much higher volume than "Launch HN" (which is YC-only), and a
// maker who has just shipped is often about to need help scaling it. Only
// posts with some traction (points) are kept, which filters weekend toys.

const API = "https://hn.algolia.com/api/v1/search_by_date";

export async function fetchShowHn({ limit = 15, sinceDays = 7, minPoints = 5 } = {}) {
  const since = Math.floor((Date.now() - sinceDays * 86400000) / 1000);
  const { data } = await axios.get(API, {
    timeout: 15000,
    params: { tags: "show_hn", numericFilters: `created_at_i>${since},points>=${minPoints}`, hitsPerPage: 100 },
  });

  const leads = [];
  for (const hit of data.hits || []) {
    if (!isUsableCompanyUrl(hit.url)) continue;
    const { name, description } = parseLaunchTitle(hit.title || "");
    if (!name || name.length > 60) continue;
    leads.push({
      companyName: name,
      website: hit.url,
      notes: description || undefined,
      sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      discoveredAt: hit.created_at ? new Date(hit.created_at) : new Date(),
      signals: ["just_launched"],
    });
    if (leads.length >= limit) break;
  }
  return leads;
}

export default { key: "show_hn", label: "Show HN — products just shipped (with traction)", needsBrowser: false, run: fetchShowHn };
