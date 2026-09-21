import { cleanOutboundUrl, isPlatformDomain } from "./browser.js";

// Product Hunt's public leaderboard — products that launched in the last day
// or two. These are the freshest "just launched, needs infrastructure" leads
// available anywhere, and the leaderboard is a public page requiring no login.
//
// Product Hunt renders the listing client-side, so this is one of the places a
// real browser genuinely earns its cost. Only the public leaderboard is read;
// no maker profiles, no login, no API key.

const PLATFORM_HOSTS = ["producthunt.com", "ph.co", "twitter.com", "x.com", "github.com", "linkedin.com", "apps.apple.com", "play.google.com"];

// Markup here changes often. Rather than pin one brittle selector chain, pull
// every product permalink on the page and derive the rest from it.
export function pickProductLinks(hrefs) {
  const slugs = new Set();
  for (const href of hrefs) {
    const match = /\/products?\/([a-z0-9][a-z0-9-]{1,80})(?:[/?#]|$)/i.exec(href || "");
    if (match) slugs.add(match[1].toLowerCase());
  }
  return [...slugs];
}

export function slugToName(slug) {
  return slug.split("-").map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

export async function fetchProductHunt(context, { limit = 15 } = {}) {
  const page = await context.newPage();
  const leads = [];
  try {
    await page.goto("https://www.producthunt.com/", { timeout: 30000, waitUntil: "domcontentloaded" });
    // The leaderboard hydrates after load; a short settle beats a fixed sleep
    // but still gives up rather than hanging the whole run.
    await page.waitForSelector("a[href*='/products/'], a[href*='/posts/']", { timeout: 15000 }).catch(() => {});

    const hrefs = await page.$$eval("a[href]", (els) => els.map((e) => e.getAttribute("href")));
    const slugs = pickProductLinks(hrefs).slice(0, limit);

    for (const slug of slugs) {
      const productUrl = `https://www.producthunt.com/products/${slug}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        await page.goto(productUrl, { timeout: 25000, waitUntil: "domcontentloaded" });
        // eslint-disable-next-line no-await-in-loop
        const name = await page.$eval("h1", (el) => el.textContent.trim()).catch(() => slugToName(slug));
        // eslint-disable-next-line no-await-in-loop
        const description = await page
          .$eval("meta[name='description']", (el) => el.getAttribute("content"))
          .catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        const outbound = await page.$$eval("a[href]", (els) => els.map((e) => e.getAttribute("href")));

        const website = outbound
          .map(cleanOutboundUrl)
          .find((u) => u && !isPlatformDomain(u, PLATFORM_HOSTS));
        if (!website) continue;

        leads.push({
          companyName: name || slugToName(slug),
          website,
          notes: description ? description.slice(0, 400) : undefined,
          sourceUrl: productUrl,
          discoveredAt: new Date(),
          signals: ["just_launched"],
        });
      } catch {
        // One unreadable product page is not a failed source.
      }
    }
  } finally {
    await page.close();
  }
  return leads;
}

export default { key: "product_hunt", label: "Product Hunt launches", needsBrowser: true, run: fetchProductHunt };
