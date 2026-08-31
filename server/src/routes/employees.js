import { Router } from "express";
import Employee from "../models/Employee.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// Full org chart, nested for the dashboard's tree layout.
router.get("/tree", async (_req, res) => {
  const all = await Employee.find().lean();
  const byId = {};
  all.forEach((e) => (byId[e._id] = { ...e, reports: [] }));
  let root = null;
  all.forEach((e) => {
    if (e.reportsTo && byId[e.reportsTo]) {
      byId[e.reportsTo].reports.push(byId[e._id]);
    } else {
      root = byId[e._id];
    }
  });
  res.json({ root });
});

router.get("/", async (req, res) => {
  const q = {};
  if (req.query.department) q.department = req.query.department;
  const list = await Employee.find(q).sort({ level: 1, name: 1 }).lean();
  res.json(list);
});

export default router;
