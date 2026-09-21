import { chromium } from "playwright";

// Shared Playwright plumbing for the discovery adapters. One browser per
// pipeline run, reused across sources — launching Chromium per source costs
// more than every page load in a run put together.

const UA = "VexForgeLeadScout/1.0 (+B2B lead discovery; low volume)";

export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    // Only the DOM matters here — dropping images/fonts/media cuts page weight
    // enough to matter when a run walks several listing pages.
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) return route.abort();
      return route.continue();
    });
    return await fn(context);
  } finally {
    await browser.close();
  }
}

// Discovery adapters read listing pages whose markup changes without notice.
// A selector that silently stopped matching should surface as "this source
// found nothing" in the run record, not as a crashed pipeline.
export async function safeSource(name, fn) {
  const startedAt = new Date();
  try {
    const leads = await fn();
    return { source: name, ok: true, found: leads.length, leads, error: null, startedAt, finishedAt: new Date() };
  } catch (err) {
    console.error(`[discovery:${name}] failed:`, err.message);
    return { source: name, ok: false, found: 0, leads: [], error: err.message, startedAt, finishedAt: new Date() };
  }
}

// Strips tracking/redirect wrappers and trailing junk off an outbound link so
// two spellings of the same company collapse to one domain for dedupe.
export function cleanOutboundUrl(href) {
  if (!href) return null;
  try {
    const url = new URL(href);
    // Listing sites route outbound clicks through their own redirector.
    const nested = url.searchParams.get("url") || url.searchParams.get("u") || url.searchParams.get("target");
    const resolved = nested ? new URL(nested) : url;
    if (!/^https?:$/.test(resolved.protocol)) return null;
    resolved.hash = "";
    resolved.search = "";
    return resolved.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isPlatformDomain(url, platformHosts) {
  if (!url) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return platformHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
}
