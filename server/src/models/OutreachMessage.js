import mongoose from "mongoose";

const { Schema } = mongoose;

// AI-drafted outreach for a lead. Every message sits in `draft` until a
// human approves it, and even then nothing is sent automatically for
// LinkedIn (no browser/API access) — approval just unlocks the "copy to
// LinkedIn" / "send email" action for a person to actually trigger.
const outreachMessageSchema = new Schema(
  {
    lead: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    channel: { type: String, enum: ["email", "linkedin"], required: true },
    subject: { type: String },
    body: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "approved", "rejected", "sent", "responded"],
      default: "draft",
    },
    draftedBy: { type: Schema.Types.ObjectId, ref: "Employee" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "Employee" },
    sentAt: { type: Date },
    sentVia: { type: String, enum: ["auto_email", "manual"], default: "manual" },
    reviewNote: { type: String },
    // Set by followUpService when a lead's gone quiet after the first
    // message — lets the nudge job know not to draft a second follow-up.
    isFollowUp: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("OutreachMessage", outreachMessageSchema);
