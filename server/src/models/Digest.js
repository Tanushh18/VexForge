import mongoose from "mongoose";

const { Schema } = mongoose;

// A weekly recap generated from the ActivityLog by the local model
// (see services/digestService.js). Surfaced on the Dashboard and, if
// Telegram is configured, pushed there too.
const digestSchema = new Schema(
  {
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    text: { type: String, required: true },
    activityCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Digest", digestSchema);
