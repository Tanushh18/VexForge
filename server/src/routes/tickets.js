import { Router } from "express";
import Ticket from "../models/Ticket.js";
import Employee, { setAgentStatus } from "../models/Employee.js";
import { logActivity } from "../models/ActivityLog.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  const list = await Ticket.find(q).sort({ createdAt: -1 }).populate("assignedTo", "name title").lean();
  res.json(list);
});

router.post("/", async (req, res) => {
  const agent = await Employee.findOne({ title: /Call & Feedback Agent/i });
  const ticket = await Ticket.create({ ...req.body, assignedTo: agent?._id });
  if (agent) await setAgentStatus(agent._id, { status: "on_call", currentTask: `On a ${req.body.channel || "call"} with ${req.body.contactName}` });
  await logActivity({ actor: agent?._id, actorName: agent?.name || "Support", department: "Support", action: "Ticket opened", detail: `${req.body.contactName} — ${req.body.reason}`, entityType: "Ticket", entityId: ticket._id });
  res.status(201).json(ticket);
});

router.patch("/:id", async (req, res) => {
  const ticket = await Ticket.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (req.body.status === "resolved" && ticket.assignedTo) {
    await setAgentStatus(ticket.assignedTo, { status: "idle", currentTask: "Standing by", bumpCompleted: true });
    await logActivity({ actor: ticket.assignedTo, actorName: "Support", department: "Support", action: "Ticket resolved", detail: ticket.contactName, entityType: "Ticket", entityId: ticket._id });
  }
  res.json(ticket);
});

export default router;
