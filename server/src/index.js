import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/db.js";
import { parseAllowedOrigins, originChecker } from "./config/origins.js";
import { runSeed } from "./services/seed.js";
import { startBackgroundJobs } from "./services/jobRegistry.js";
import { getSettings } from "./models/Settings.js";
import { setOllamaUrlOverride, refreshModelHealth } from "../../shared/modelRouter.js";

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
import pipelineRoutes from "./routes/pipeline.js";

const app = express();
app.set("trust proxy", 1); // behind a tunnel/reverse proxy — needed for rate-limit to key on the real client IP
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CLIENT_ORIGIN);
app.use(cors({ origin: originChecker(ALLOWED_ORIGINS) }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Generous general ceiling now that this is reachable over a public tunnel;
// a much tighter one on login specifically, since that's the credential-
// guessing target.
app.use("/api", rateLimit({ windowMs: 5 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.get("/api/health", (_req, res) => res.json({ ok: true, company: "VexForge HQ" }));

// A dedicated, unauthenticated, zero-DB-touch route for uptime crons (e.g.
// cron-job.org, GitHub Actions) that just need to stop the free Render
// instance from spinning down — /api/health works too, but this name makes
// the intent explicit and keeps health checks and keep-alive pings separable
// if they ever need to diverge.
app.get("/api/ping", (_req, res) => res.status(200).send("pong"));

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
app.use("/api/pipeline", pipelineRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => runSeed())
  .then(async () => {
    const { ollamaUrl } = await getSettings();
    if (ollamaUrl) {
      setOllamaUrlOverride(ollamaUrl);
      await refreshModelHealth();
    }
  })
  .then(() => {
    app.listen(PORT, () => console.log(`[vexforge-hq] server listening on :${PORT}`));
    startBackgroundJobs();
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
