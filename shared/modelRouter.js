// Routes each kind of work to a *different* local model, instead of asking one
// small model to do everything. Three roles, because the trade-offs differ:
//
//   reasoning — decisions that change what the pipeline does (lead scoring,
//               fit assessment, ticket triage, digests). Worth a bigger,
//               slower model: a wrong call here wastes a real send slot.
//   drafting  — outreach copy. Mid-size; fluency matters more than judgement.
//   fast      — classification and one-line summaries. Small and cheap; these
//               run constantly and a 14B model would make the UI crawl.
//
// Everything runs against a local Ollama. The older VexForge-LocalLLM sibling
// service is still supported as a backend so existing setups keep working;
// `LLM_BACKEND=auto` (the default) prefers Ollama and falls back to it.

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const LOCAL_LLM_URL = (process.env.LOCAL_LLM_URL || "http://localhost:5001").replace(/\/$/, "");
const BACKEND = process.env.LLM_BACKEND || "auto"; // auto | ollama | localllm

export const ROLES = ["reasoning", "drafting", "fast"];

// Defaults are the Qwen2.5 instruct line: one family, three sizes, so output
// style stays consistent across roles and you only pull one vocabulary.
export const MODELS = {
  reasoning: process.env.OLLAMA_MODEL_REASONING || "qwen2.5:14b-instruct",
  drafting: process.env.OLLAMA_MODEL_DRAFTING || "qwen2.5:7b-instruct",
  fast: process.env.OLLAMA_MODEL_FAST || "qwen2.5:3b-instruct",
};

// If a machine can't hold the 14B, one env var collapses every role onto a
// single model rather than forcing three separate overrides.
if (process.env.OLLAMA_MODEL_ALL) {
  for (const role of ROLES) MODELS[role] = process.env.OLLAMA_MODEL_ALL;
}

const state = {
  backend: null,
  ollamaUp: false,
  localLlmUp: false,
  installed: [],
  lastCheck: null,
};

async function probeOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    state.installed = (data.models || []).map((m) => m.name);
    return true;
  } catch {
    state.installed = [];
    return false;
  }
}

async function probeLocalLlm() {
  try {
    const res = await fetch(`${LOCAL_LLM_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return !!(data.ok && data.modelPulled);
  } catch {
    return false;
  }
}

export async function refreshModelHealth() {
  const [ollamaUp, localLlmUp] = await Promise.all([
    BACKEND === "localllm" ? Promise.resolve(false) : probeOllama(),
    BACKEND === "ollama" ? Promise.resolve(false) : probeLocalLlm(),
  ]);
  state.ollamaUp = ollamaUp;
  state.localLlmUp = localLlmUp;
  state.backend = ollamaUp ? "ollama" : localLlmUp ? "localllm" : null;
  state.lastCheck = new Date();
  return state;
}

refreshModelHealth();
setInterval(refreshModelHealth, 15000).unref?.();

export function llmReady() {
  return state.backend !== null;
}

// A role is only *really* available on Ollama if its model is actually pulled;
// an unpulled model 404s at generate time. Ollama tags carry a `:latest`
// suffix that `ollama pull qwen2.5:7b-instruct` does not, so compare loosely.
export function roleAvailable(role) {
  if (state.backend === "localllm") return true; // that service owns its own model
  if (state.backend !== "ollama") return false;
  const want = MODELS[role];
  return state.installed.some((n) => n === want || n.replace(/:latest$/, "") === want.replace(/:latest$/, ""));
}

// Falls back down the size ladder rather than failing: a scored lead from the
// 3B model beats no scored lead at all, and the caller is told what it got.
export function resolveRole(role) {
  const ladder = { reasoning: ["reasoning", "drafting", "fast"], drafting: ["drafting", "fast", "reasoning"], fast: ["fast", "drafting", "reasoning"] };
  for (const candidate of ladder[role] || [role]) {
    if (roleAvailable(candidate)) return candidate;
  }
  return null;
}

export function modelStatus() {
  return {
    backend: state.backend,
    ollamaUrl: OLLAMA_URL,
    localLlmUrl: LOCAL_LLM_URL,
    lastCheck: state.lastCheck,
    installed: state.installed,
    roles: ROLES.map((role) => ({
      role,
      model: MODELS[role],
      available: roleAvailable(role),
      resolvesTo: resolveRole(role),
    })),
  };
}

async function ollamaChat({ model, system, prompt, json, timeoutMs, temperature }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: json ? "json" : undefined,
      options: { temperature: temperature ?? (json ? 0 : 0.7) },
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return data.message?.content ?? "";
}

// The older sibling service exposes only a summarize endpoint, with no
// separate system-prompt slot — so the system prompt is folded into the
// instruction. Without this, a JSON-format request sent through this backend
// loses its "reply with JSON only" rule and every structured call fails.
async function localLlmSummarize({ system, prompt, timeoutMs }) {
  const res = await fetch(`${LOCAL_LLM_URL}/v1/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: system ? `${system}\n\n${prompt}` : prompt, data: {} }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Local LLM service returned ${res.status}`);
  const data = await res.json();
  return data.text ?? "";
}

// The one call everything else goes through. `role` picks the model; the
// caller never names a model directly, so swapping models is an env change.
export async function complete(role, { system, prompt, json = false, timeoutMs = 120000, temperature }) {
  if (!llmReady()) throw new Error("No local model backend reachable — is Ollama running?");
  if (state.backend === "localllm") return localLlmSummarize({ system, prompt, timeoutMs });

  const resolved = resolveRole(role);
  if (!resolved) throw new Error(`No local model available for role "${role}" — run: ollama pull ${MODELS[role]}`);
  return ollamaChat({ model: MODELS[resolved], system, prompt, json, timeoutMs, temperature });
}

// Models drift into prose around their JSON even with format:"json" set, and
// a reasoning step that throws on a stray "Here you go:" is a reasoning step
// that fails in production. Salvage the first balanced object instead.
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
