import mongoose from "mongoose";

const { Schema } = mongoose;

// Call / support tickets handled by the Support team. Live telephony isn't
// wired up (needs your own Twilio number + credentials) — this tracks the
// conversation either way: paste a transcript, or upload audio for
// auto-transcription if TRANSCRIBE_API_KEY is configured.
const ticketSchema = new Schema(
  {
    contactName: { type: String, required: true },
    contactPhone: { type: String },
    contactEmail: { type: String },
    company: { type: String },
    channel: { type: String, enum: ["call", "email", "chat", "whatsapp"], default: "call" },
    reason: { type: String, enum: ["feedback", "support", "sales", "complaint"], default: "support" },
    status: { type: String, enum: ["open", "in_progress", "resolved", "escalated"], default: "open" },
    transcript: { type: String },
    summary: { type: String },
    resolutionNotes: { type: String },
    assignedTo: { type: Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

export default mongoose.model("Ticket", ticketSchema);
