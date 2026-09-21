import { cleanOutboundUrl, isPlatformDomain } from "./browser.js";

// Y Combinator's public company directory, filtered to the most recent
// batches. Every company here has demonstrably just taken funding, which is
// the strongest signal in the scoring model — and YC's "hiring" filter gives
// a second signal for free.
//
// Public directory only: no founder profiles, no contact details, no login.
// Contact emails still come from each company's own site via the enrichment
// step, exactly as they do for a manually-added lead.

const PLATFORM_HOSTS = ["ycombinator.com", "twitter.com", "x.com", "linkedin.com", "github.com", "crunchbase.com", "facebook.com"];

export function directoryUrl({ batches = [], hiringOnly = false } = {}) {
  const params = new URLSearchParams();
  for (const b of batches) params.append("batch", b);
  if (hiringOnly) params.set("isHiring", "true");
  const qs = params.toString();
  return `https://www.ycombinator.com/companies${qs ? `?${qs}` : ""}`;
}

// YC's directory links companies at /companies/<slug>; everything else on the
// page (nav, batch filters, blog) is noise.
export function pickCompanySlugs(hrefs) {
  const slugs = new Set();
  for (const href of hrefs) {
    const match = /^\/companies\/([a-z0-9][a-z0-9-]{1,80})(?:[/?#]|$)/i.exec(href || "");
    if (match && match[1] !== "founders") slugs.add(match[1].toLowerCase());
  }
  return [...slugs];
}

export async function fetchYcDirectory(context, { limit = 15, batches = [], hiringOnly = true } = {}) {
  const page = await context.newPage();
  const leads = [];
  try {
    await page.goto(directoryUrl({ batches, hiringOnly }), { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForSelector("a[href^='/companies/']", { timeout: 20000 }).catch(() => {});

    const hrefs = await page.$$eval("a[href]", (els) => els.map((e) => e.getAttribute("href")));
    const slugs = pickCompanySlugs(hrefs).slice(0, limit);

    for (const slug of slugs) {
      const profileUrl = `https://www.ycombinator.com/companies/${slug}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        await page.goto(profileUrl, { timeout: 25000, waitUntil: "domcontentloaded" });
        // eslint-disable-next-line no-await-in-loop
        const name = await page.$eval("h1", (el) => el.textContent.trim()).catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        const description = await page
          .$eval("meta[name='description']", (el) => el.getAttribute("content"))
          .catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        const outbound = await page.$$eval("a[href]", (els) => els.map((e) => e.getAttribute("href")));
        // eslint-disable-next-line no-await-in-loop
        const bodyText = await page.textContent("body").catch(() => "");

        const website = outbound.map(cleanOutboundUrl).find((u) => u && !isPlatformDomain(u, PLATFORM_HOSTS));
        if (!website) continue;

        const signals = ["just_funded"];
        if (/is hiring|open roles|jobs at/i.test(bodyText || "")) signals.push("hiring");

        leads.push({
          companyName: name || slug,
          website,
          notes: description ? description.slice(0, 400) : undefined,
          sourceUrl: profileUrl,
          discoveredAt: new Date(),
          signals,
        });
      } catch {
        // Skip unreadable profiles rather than failing the source.
      }
    }
  } finally {
    await page.close();
  }
  return leads;
}

export default { key: "yc_directory", label: "Y Combinator directory (funded + hiring)", needsBrowser: true, run: fetchYcDirectory };
