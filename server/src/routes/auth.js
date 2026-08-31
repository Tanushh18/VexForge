import { Router } from "express";
import { signCeoToken } from "../middleware/auth.js";

const router = Router();

// Single-admin login — this whole app is your internal command center.
router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (email !== process.env.CEO_EMAIL || password !== process.env.CEO_PASSWORD) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signCeoToken();
  res.json({ token, name: process.env.CEO_NAME || "Founder" });
});

export default router;
