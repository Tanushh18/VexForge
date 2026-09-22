import mongoose from "mongoose";

// One document, fixed id — a small key/value bag for admin-configurable
// runtime settings that shouldn't require a redeploy to change (e.g. the
// Ollama tunnel URL, set from Admin · System instead of an env var).
const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "singleton" },
    ollamaUrl: { type: String, default: "" },
    // Where the source-rotation batch picker left off (see
    // services/pipelineQueue.js) — persisted so the rotation actually
    // advances across restarts instead of always starting from source #1.
    rotationCursor: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Settings = mongoose.model("Settings", settingsSchema);

export async function getSettings() {
  return (await Settings.findById("singleton").lean()) || { ollamaUrl: "", rotationCursor: 0 };
}

export async function updateSettings(patch) {
  return Settings.findByIdAndUpdate(
    "singleton",
    { $set: patch },
    { upsert: true, new: true }
  ).lean();
}

export default Settings;
