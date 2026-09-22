import mongoose from "mongoose";

const { Schema } = mongoose;

// Represents everyone in the org chart — the human CEO (you), and every
// AI agent "worker" underneath. Real backend actions update `status` /
// `currentTask` on the relevant agent so the dashboard reflects real work,
// not a static picture.
const employeeSchema = new Schema(
  {
    name: { type: String, required: true },
    title: { type: String, required: true },
    department: {
      type: String,
      enum: ["Executive", "Operations", "Product", "HR", "Tech", "Finance", "Support"],
      required: true,
    },
    level: {
      type: String,
      enum: ["ceo", "head_manager", "manager", "agent"],
      required: true,
    },
    reportsTo: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    isHuman: { type: Boolean, default: false },
    avatarColor: { type: String, default: "#ff7a2e" },
    avatarInitial: { type: String, default: "A" },
    status: {
      type: String,
      enum: ["idle", "working", "on_call", "offline"],
      default: "idle",
    },
    currentTask: { type: String, default: "Standing by" },
    // Which local model class this agent's work runs on — `reasoning` for
    // decisions, `drafting` for writing, `fast` for classification, `none`
    // for agents whose work is pure database bookkeeping. Documents the
    // routing the backend actually performs so the org chart isn't fiction.
    modelRole: { type: String, enum: ["reasoning", "drafting", "fast", "none"], default: "fast" },
    skills: [{ type: String }],
    tasksCompleted: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export async function setAgentStatus(employeeId, { status, currentTask, bumpCompleted }) {
  const update = { lastActive: new Date() };
  if (status) update.status = status;
  if (currentTask) update.currentTask = currentTask;
  const inc = bumpCompleted ? { tasksCompleted: 1 } : undefined;
  return mongoose.model("Employee").findByIdAndUpdate(
    employeeId,
    inc ? { $set: update, $inc: inc } : { $set: update },
    { new: true }
  );
}

export default mongoose.model("Employee", employeeSchema);
