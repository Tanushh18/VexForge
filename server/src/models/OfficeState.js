import mongoose from "mongoose";

const { Schema } = mongoose;

// The Live Office's own day — clock, per-robot attendance, tasks completed,
// morale and staffing. Kept server-side (rather than in localStorage) so the
// office looks the same after a reload and from any device you open it on.
// One document, upserted by key.
const officeStateSchema = new Schema(
  {
    key: { type: String, default: "office", unique: true, index: true },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model("OfficeState", officeStateSchema);
