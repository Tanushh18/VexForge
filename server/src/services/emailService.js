import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // Not configured — caller should fall back to "copy & send manually".
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export function emailIsConfigured() {
  return !!getTransporter();
}

// Only ever called from the "Send" button on an already-`approved`
// OutreachMessage — see routes/outreach.js. Nothing in this file triggers
// on its own.
export async function sendApprovedEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    throw new Error("SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS in .env, or send this manually.");
  }
  const fromName = process.env.SMTP_FROM_NAME || "VexForge";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html,
  });
}
