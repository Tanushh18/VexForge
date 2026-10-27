// Where the VexForge API lives. Stashr is the ONLY source (project "vexforge" Server URLs): there is no env value, no
// same-origin proxy and no fallback address. Switched off or never reached means the console reaches no server (the
// last answer Stashr gave is kept for next time). `npm run dev` still uses Vite's local /api proxy.
const REGISTRY_HOST = "https://password-manager-server-xxdr.onrender.com";
const APP = "vexforge";
const CACHE_KEY = "stashr.server." + APP;
// Used as the address when Stashr has none: every request then fails at once.
export const NO_SERVER = "https://stashr-no-server.invalid";
const strip = (url) => String(url || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");

const readCache = () => { try { const v = JSON.parse(localStorage.getItem(CACHE_KEY)); return v && typeof v.url === "string" ? v : null; } catch { return null; } };
const writeCache = (url) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ url })); } catch { /* private mode */ } };

/** Stashr's answer: { url } (empty = switched off), or null when Stashr cannot be reached. */
async function fromStashr(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${REGISTRY_HOST}/registry/${APP}`, { signal: controller.signal });
    if (!res.ok) return null;
    const url = strip(((await res.json()).urls || [])[0]);
    return { url: /^https?:\/\//i.test(url) ? url : "" };
  } catch { return null; } finally { clearTimeout(timer); }
}

let pending = null;

/** The API origin to call. Instant after the first visit (refreshed in the background). */
export function apiOrigin() {
  if (import.meta.env.DEV) return Promise.resolve("");
  if (!pending) {
    const cached = readCache();
    if (cached) {
      pending = Promise.resolve(cached.url || NO_SERVER);
      fromStashr(60000).then((answer) => { if (answer) writeCache(answer.url); });
    } else {
      pending = fromStashr(30000).then((answer) => { if (answer) writeCache(answer.url); return answer && answer.url ? answer.url : NO_SERVER; });
    }
  }
  return pending;
}
