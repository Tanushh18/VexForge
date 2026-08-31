import { Router } from "express";
import ActivityLog from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const items = await ActivityLog.find().sort({ createdAt: -1 }).limit(limit).lean();
  res.json(items);
});

export default router;
