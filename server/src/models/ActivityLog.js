import mongoose from "mongoose";

const { Schema } = mongoose;

// Every meaningful action across the company gets one row here — this is
// the audit trail ("all things to be recorded and saved").
const activityLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "Employee" },
    actorName: { type: String, required: true },
    department: { type: String },
    action: { type: String, required: true },
    detail: { type: String },
    entityType: { type: String },
    entityId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

export async function logActivity({ actor, actorName, department, action, detail, entityType, entityId }) {
  return mongoose.model("ActivityLog").create({
    actor,
    actorName,
    department,
    action,
    detail,
    entityType,
    entityId,
  });
}

export default mongoose.model("ActivityLog", activityLogSchema);
