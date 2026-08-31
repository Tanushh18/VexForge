import { Router } from "express";
import ChatMessage from "../models/ChatMessage.js";
import { requireAuth } from "../middleware/auth.js";
import { runChatTurn, chatbotConfigured } from "../services/claudeService.js";

const router = Router();
router.use(requireAuth);

router.get("/config", (_req, res) => res.json({ configured: chatbotConfigured() }));

router.get("/history", async (_req, res) => {
  const msgs = await ChatMessage.find().sort({ createdAt: 1 }).limit(200).lean();
  res.json(msgs);
});

router.post("/", async (req, res) => {
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });

  await ChatMessage.create({ role: "user", content: message });
  try {
    const reply = await runChatTurn(message, history || []);
    await ChatMessage.create({ role: "assistant", content: reply });
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
