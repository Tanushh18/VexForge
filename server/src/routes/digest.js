import { Router } from "express";
import Digest from "../models/Digest.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/latest", async (_req, res) => {
  const digest = await Digest.findOne().sort({ createdAt: -1 }).lean();
  res.json(digest || null);
});

router.get("/", async (_req, res) => {
  const digests = await Digest.find().sort({ createdAt: -1 }).limit(10).lean();
  res.json(digests);
});

export default router;
