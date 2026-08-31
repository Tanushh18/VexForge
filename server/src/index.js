import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { connectDB } from "./config/db.js";
import { runSeed } from "./services/seed.js";

import authRoutes from "./routes/auth.js";
import employeeRoutes from "./routes/employees.js";
import leadRoutes from "./routes/leads.js";
import outreachRoutes from "./routes/outreach.js";
import ticketRoutes from "./routes/tickets.js";
import chatRoutes from "./routes/chat.js";
import activityRoutes from "./routes/activity.js";
import publicRoutes from "./routes/public.js";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => res.json({ ok: true, company: "VexForge HQ" }));

// Open CORS just for the public contact-form endpoint, since the marketing
// site in /website is a static file that may be hosted anywhere.
app.use("/api/public", cors(), publicRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/outreach", outreachRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/activity", activityRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => runSeed())
  .then(() => {
    app.listen(PORT, () => console.log(`[vexforge-hq] server listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
