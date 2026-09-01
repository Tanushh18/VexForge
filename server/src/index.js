import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/db.js";
import { runSeed } from "./services/seed.js";
import { checkForReplies } from "./services/inboxService.js";
import { runFollowUpCheck } from "./services/followUpService.js";
import { generateWeeklyDigest, shouldRunWeeklyDigest } from "./services/digestService.js";

import authRoutes from "./routes/auth.js";
import employeeRoutes from "./routes/employees.js";
import leadRoutes from "./routes/leads.js";
import outreachRoutes from "./routes/outreach.js";
import ticketRoutes from "./routes/tickets.js";
import chatRoutes from "./routes/chat.js";
import activityRoutes from "./routes/activity.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import digestRoutes from "./routes/digest.js";

const app = express();
app.set("trust proxy", 1); // behind a tunnel/reverse proxy — needed for rate-limit to key on the real client IP
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Generous general ceiling now that this is reachable over a public tunnel;
// a much tighter one on login specifically, since that's the credential-
// guessing target.
app.use("/api", rateLimit({ windowMs: 5 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.get("/api/health", (_req, res) => res.json({ ok: true, company: "VexForge HQ" }));

// Open CORS just for the public contact-form endpoint, since the marketing
// site in /website is a static file that may be hosted anywhere.
app.use("/api/public", cors(), publicRoutes);

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/outreach", outreachRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/digest", digestRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

const PORT = process.env.PORT || 4000;

function startBackgroundJobs() {
  const REPLY_CHECK_MS = 5 * 60 * 1000;
  const FOLLOWUP_CHECK_MS = 6 * 60 * 60 * 1000;
  const DIGEST_CHECK_MS = 12 * 60 * 60 * 1000;

  const safe = (name, fn) => fn().catch((err) => console.error(`[jobs] ${name} failed:`, err.message));

  setInterval(() => safe("checkForReplies", checkForReplies), REPLY_CHECK_MS).unref();
  setInterval(() => safe("runFollowUpCheck", runFollowUpCheck), FOLLOWUP_CHECK_MS).unref();
  setInterval(() => {
    shouldRunWeeklyDigest().then((due) => {
      if (due) safe("generateWeeklyDigest", generateWeeklyDigest);
    });
  }, DIGEST_CHECK_MS).unref();

  // One light pass shortly after boot so a freshly-started server doesn't
  // wait a full interval before doing anything.
  setTimeout(() => safe("checkForReplies", checkForReplies), 15000).unref();
}

connectDB()
  .then(() => runSeed())
  .then(() => {
    app.listen(PORT, () => console.log(`[vexforge-hq] server listening on :${PORT}`));
    startBackgroundJobs();
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
