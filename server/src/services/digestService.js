import ActivityLog from "../models/ActivityLog.js";
import Digest from "../models/Digest.js";
import { summarizeForDigest } from "./llmService.js";
import { notify } from "./notifyService.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Summarizes the last 7 days of ActivityLog into one digest entry, surfaced
// on the Dashboard and pushed to Telegram if configured. Only runs once per
// period — see shouldRunWeeklyDigest().
export async function generateWeeklyDigest() {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - WEEK_MS);

  const items = await ActivityLog.find({ createdAt: { $gte: periodStart, $lte: periodEnd } })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  if (items.length === 0) return null;

  const grouped = items.reduce((acc, a) => {
    acc[a.department || "Other"] = (acc[a.department || "Other"] || 0) + 1;
    return acc;
  }, {});

  const text = await summarizeForDigest(
    "Write a short weekly recap for the founder: what happened across the company this week, grouped by department. A few sentences, plain language, no headers.",
    { activityCountByDepartment: grouped, sampleEvents: items.slice(0, 40).map((a) => `${a.actorName}: ${a.action} — ${a.detail || ""}`) }
  );
  if (!text) return null;

  const digest = await Digest.create({ periodStart, periodEnd, text, activityCount: items.length });
  await notify(`📋 *Weekly digest*\n\n${text}`);
  return digest;
}

export async function shouldRunWeeklyDigest() {
  const last = await Digest.findOne().sort({ createdAt: -1 }).lean();
  if (!last) return true;
  return Date.now() - new Date(last.createdAt).getTime() > WEEK_MS;
}
