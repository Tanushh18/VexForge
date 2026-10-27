// Where the VexForge API lives. The address is kept on Stashr (project "vexforge" Server URLs), so moving the API needs
// no rebuild. If Stashr has no entry or cannot be reached, the old behaviour stays: VITE_API_BASE_URL, else the
// same-origin "/api" that the host proxies.
const REGISTRY_HOSTS = ["https://password-manager-server-xxdr.onrender.com", "https://password-manager-server-8gvj.onrender.com"];
const APP = "vexforge";
const CACHE_KEY = "stashr.server." + APP;
const strip = (url) => String(url || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
const FALLBACK = strip(import.meta.env.VITE_API_BASE_URL);

const readCache = () => { try { return strip(localStorage.getItem(CACHE_KEY)); } catch { return ""; } };
const writeCache = (url) => { try { localStorage.setItem(CACHE_KEY, url); } catch { /* private mode */ } };

async function fromStashr(timeoutMs) {
  for (const host of REGISTRY_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}/registry/${APP}`, { signal: controller.signal });
      if (!res.ok) continue;
      const url = strip(((await res.json()).urls || [])[0]);
      if (/^https?:\/\//i.test(url)) return url;
    } catch { /* try the next Stashr server */ }
    finally { clearTimeout(timer); }
  }
  return "";
}

let pending = null;

/** The API origin to call ("" means same origin). Instant after the first visit; refreshed in the background. */
export function apiOrigin() {
  if (!pending) {
    const cached = readCache();
    if (cached) {
      pending = Promise.resolve(cached);
      fromStashr(60000).then((url) => { if (url) writeCache(url); });
    } else {
      pending = fromStashr(6000).then((url) => { if (url) writeCache(url); return url || FALLBACK; });
    }
  }
  return pending;
}
