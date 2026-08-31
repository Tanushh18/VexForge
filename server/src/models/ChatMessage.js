import mongoose from "mongoose";

const { Schema } = mongoose;

// Conversation history with the Head Manager chatbot (your command console).
const chatMessageSchema = new Schema(
  {
    role: { type: String, enum: ["user", "assistant", "tool"], required: true },
    content: { type: String, required: true },
    toolCalls: [{ type: Schema.Types.Mixed }],
  },
  { timestamps: true }
);

export default mongoose.model("ChatMessage", chatMessageSchema);
