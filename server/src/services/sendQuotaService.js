import OutreachMessage from "../models/OutreachMessage.js";

// A hard ceiling on cold emails per day. This is a deliverability control, not
// a preference: a new sending domain that fires a hundred cold emails in an
// afternoon gets classified as spam, and once that reputation is set every
// later message — including replies to warm leads — lands in junk. Twenty-five
// a day is slow enough to stay under that threshold.
//
// Only automated SMTP sends count. Marking a message sent by hand is you
// sending it from your own client, which the cap has no business governing.

export const DAILY_SEND_CAP = Number(process.env.DAILY_SEND_CAP || 25);

export function startOfDay(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function sentToday(now = new Date()) {
  return OutreachMessage.countDocuments({
    sentVia: "auto_email",
    sentAt: { $gte: startOfDay(now) },
  });
}

export async function quotaStatus(now = new Date()) {
  const used = await sentToday(now);
  const remaining = Math.max(0, DAILY_SEND_CAP - used);
  return { cap: DAILY_SEND_CAP, used, remaining, resetsAt: new Date(startOfDay(now).getTime() + 24 * 60 * 60 * 1000) };
}

export async function assertSendAllowed(now = new Date()) {
  const status = await quotaStatus(now);
  if (status.remaining <= 0) {
    const err = new Error(
      `Daily send cap reached (${status.cap}/day). This protects your sending reputation — the remaining approved drafts stay queued until ${status.resetsAt.toLocaleString()}.`
    );
    err.statusCode = 429;
    err.quota = status;
    throw err;
  }
  return status;
}
