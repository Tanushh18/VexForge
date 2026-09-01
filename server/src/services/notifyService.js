// Telegram push notifications — optional. Safe to leave unconfigured; every
// caller here is fire-and-forget and never throws into the request path.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export function notifyConfigured() {
  return !!(BOT_TOKEN && CHAT_ID);
}

export async function notify(text) {
  if (!notifyConfigured()) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("[notify] Telegram send failed:", await res.text().catch(() => res.status));
  } catch (err) {
    console.error("[notify] Telegram send failed:", err.message);
  }
}
