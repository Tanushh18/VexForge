import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import Lead from "../models/Lead.js";
import OutreachMessage from "../models/OutreachMessage.js";
import { logActivity } from "../models/ActivityLog.js";
import { notify } from "./notifyService.js";

// Reply detection: polls an inbox (reusing SMTP credentials by default,
// since it's typically the same Gmail account) for unseen mail whose sender
// matches a Lead's contactEmail, and flips that lead to "responded" — the
// one stage nothing else in the app ever sets automatically.

export function imapConfigured() {
  return !!(process.env.IMAP_HOST && (process.env.IMAP_USER || process.env.SMTP_USER) && (process.env.IMAP_PASS || process.env.SMTP_PASS));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function checkForReplies() {
  if (!imapConfigured()) return { checked: false, matched: 0 };

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: {
      user: process.env.IMAP_USER || process.env.SMTP_USER,
      pass: process.env.IMAP_PASS || process.env.SMTP_PASS,
    },
    logger: false,
  });

  let matched = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        // eslint-disable-next-line no-await-in-loop
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg?.source) continue;
        // eslint-disable-next-line no-await-in-loop
        const parsed = await simpleParser(msg.source);
        const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase();
        if (!fromAddr) continue;

        // eslint-disable-next-line no-await-in-loop
        const lead = await Lead.findOne({ contactEmail: new RegExp(`^${escapeRegex(fromAddr)}$`, "i") });
        if (!lead) continue;

        lead.stage = "responded";
        // eslint-disable-next-line no-await-in-loop
        await lead.save();
        // eslint-disable-next-line no-await-in-loop
        await OutreachMessage.updateMany({ lead: lead._id, status: "sent" }, { status: "responded" });
        // eslint-disable-next-line no-await-in-loop
        await logActivity({
          actorName: "Inbox Watcher",
          department: "Operations",
          action: "Lead replied",
          detail: `${lead.companyName} <${fromAddr}>`,
          entityType: "Lead",
          entityId: lead._id,
        });
        // eslint-disable-next-line no-await-in-loop
        await notify(`📬 *${lead.companyName}* replied — moved to "responded".`);
        // eslint-disable-next-line no-await-in-loop
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        matched += 1;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return { checked: true, matched };
}
