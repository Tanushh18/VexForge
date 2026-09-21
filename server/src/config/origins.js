// CLIENT_ORIGIN parsing, kept separate from index.js so it can be unit-tested
// without booting the server.
//
// Accepts a comma-separated list: the console and the marketing site are
// separate origins once deployed, and either may be reaching this API across a
// tunnel rather than through a same-origin proxy.

export function parseAllowedOrigins(raw) {
  return (raw || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    // Hosting platforms hand out a bare hostname (Render's `fromService` host
    // property, for one), but a CORS origin must carry a scheme or every
    // preflight quietly fails.
    .map((o) => (/^https?:\/\//.test(o) ? o : `https://${o}`))
    .map((o) => o.replace(/\/+$/, ""));
}

export function originChecker(allowed) {
  return (origin, callback) => {
    // No Origin header means same-origin, curl, or a health probe — none of
    // which CORS exists to police.
    if (!origin) return callback(null, true);
    if (allowed.includes(origin.replace(/\/+$/, ""))) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not in CLIENT_ORIGIN`));
  };
}
