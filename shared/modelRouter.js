// Routes each kind of work to a *different* Groq-hosted model, instead of
// asking one model to do everything. Three roles, because the trade-offs
// differ:
//
//   reasoning — decisions that change what the pipeline does (lead scoring,
//               fit assessment, ticket triage, digests). Worth the bigger model.
//   drafting  — outreach copy. Mid-size; fluency matters more than judgement.
//   fast      — classification and one-line summaries. Small and cheap; these
//               run constantly.
//
// Backend: Groq's free-tier API only (OpenAI-compatible /chat/completions).
// GROQ_API_KEYS is a comma-separated list — each one is its own free-tier
// account with its own daily/per-minute caps, so holding several and rotating
// past a rate-limited or dead key multiplies the effective daily budget. This
// is pure fallback, not load-balancing: a key is used until it fails (429 or
// any other error), then the next one takes over; it does not round-robin
// across keys on every call.

function parseKeys() {
  return (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const ROLES = ["reasoning", "drafting", "fast"];

// Groq's free-tier catalog: one family (Llama 3.x) across two sizes, so
// output style stays consistent across roles.
export const MODELS = {
  reasoning: process.env.GROQ_MODEL_REASONING || "llama-3.3-70b-versatile",
  drafting: process.env.GROQ_MODEL_DRAFTING || "llama-3.1-8b-instant",
  fast: process.env.GROQ_MODEL_FAST || "llama-3.1-8b-instant",
};

// One env var collapses every role onto a single model, same pattern as the
// old OLLAMA_MODEL_ALL escape hatch.
if (process.env.GROQ_MODEL_ALL) {
  for (const role of ROLES) MODELS[role] = process.env.GROQ_MODEL_ALL;
}

const state = {
  keys: parseKeys(),
  // Index of the key currently in use. Sticky across calls: a key stays
  // "current" until it fails, so a working key isn't abandoned needlessly.
  currentIndex: 0,
};

export function llmReady() {
  return state.keys.length > 0;
}

// Kept for API compatibility with callers that used to re-probe Ollama after
// an admin-set URL change. Groq has nothing to probe — readiness is just
// "is at least one key configured" — so this is a no-op that resolves
// immediately.
export async function refreshModelHealth() {
  state.keys = parseKeys();
  if (state.currentIndex >= state.keys.length) state.currentIndex = 0;
  return modelStatus();
}

export function modelStatus() {
  return {
    backend: llmReady() ? "groq" : null,
    keyCount: state.keys.length,
    activeKeyIndex: llmReady() ? state.currentIndex : null,
    roles: ROLES.map((role) => ({
      role,
      model: MODELS[role],
      available: llmReady(),
      resolvesTo: llmReady() ? role : null,
    })),
  };
}

function maskKey(key) {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "****";
}

async function groqChat({ key, model, system, prompt, json, timeoutMs, temperature }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: temperature ?? (json ? 0 : 0.7),
      response_format: json ? { type: "json_object" } : undefined,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Groq returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// The one call everything else goes through. `role` picks the model; the
// caller never names a model directly, so swapping models is an env change.
//
// Rotation: tries the current key first, and on a rate-limit (429) or auth
// failure (401/403) — the two cases where retrying the SAME key is pointless
// — advances to the next one and retries, up to once per configured key. Any
// other error (timeout, 5xx, network) is NOT treated as a reason to burn
// through keys; it's surfaced immediately, since the key itself is probably
// fine and the caller's own retry/fallback logic (e.g. scoring's "return the
// deterministic score" catch) already handles transient failures.
export async function complete(role, { system, prompt, json = false, timeoutMs = 120000, temperature }) {
  if (!llmReady()) throw new Error("No Groq API key configured — set GROQ_API_KEYS.");
  const model = MODELS[role] || MODELS.fast;

  let lastErr;
  for (let attempt = 0; attempt < state.keys.length; attempt++) {
    const key = state.keys[state.currentIndex];
    try {
      return await groqChat({ key, model, system, prompt, json, timeoutMs, temperature });
    } catch (err) {
      lastErr = err;
      if (err.status === 429 || err.status === 401 || err.status === 403) {
        console.warn(`[modelRouter] key ${maskKey(key)} ${err.status === 429 ? "rate-limited" : "rejected"} — rotating to next key`);
        state.currentIndex = (state.currentIndex + 1) % state.keys.length;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("All configured Groq keys are rate-limited or invalid.");
}

// Models drift into prose around their JSON even with response_format set,
// and a reasoning step that throws on a stray "Here you go:" is a reasoning
// step that fails in production. Salvage the first balanced object instead.
export function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Asks a role for structured output and hands back a parsed object, or null
// if the model produced nothing usable — callers treat null as "no opinion"
// and fall back to their deterministic path.
export async function completeJson(role, { system, prompt, timeoutMs }) {
  const text = await complete(role, { system, prompt, json: true, timeoutMs, temperature: 0 });
  return parseJsonLoose(text);
}
