import mongoose from "mongoose";

const { Schema } = mongoose;

// One end-to-end pass of the lead pipeline: discover → dedupe → enrich →
// score → draft. Each run is recorded so a bad batch can be traced back to
// the source and the settings that produced it, rather than just appearing
// in the CRM with no provenance.
const pipelineRunSchema = new Schema(
  {
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
    trigger: { type: String, enum: ["manual", "scheduled"], default: "manual" },
    options: {
      sources: [{ type: String }],
      perSource: { type: Number },
      enrich: { type: Boolean },
      useModelScoring: { type: Boolean },
      autoDraftTop: { type: Number },
    },
    // Per-source outcome, so "the run found nothing" can be told apart from
    // "Product Hunt changed its markup again".
    sourceResults: [
      {
        source: String,
        ok: Boolean,
        found: Number,
        error: String,
      },
    ],
    stats: {
      discovered: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      enriched: { type: Number, default: 0 },
      scored: { type: Number, default: 0 },
      drafted: { type: Number, default: 0 },
      hot: { type: Number, default: 0 },
    },
    summary: { type: String },
    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("PipelineRun", pipelineRunSchema);
