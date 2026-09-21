import mongoose from "mongoose";

const { Schema } = mongoose;

// One end-to-end pass of the lead pipeline: discover → dedupe → enrich →
// score → draft. Since the Playwright half runs on a local worker rather than
// here, this document is also the job ticket: the UI creates it as `queued`,
// the worker claims it, reports progress against it, and closes it out.
//
// That indirection is what lets the Pipeline page keep working unchanged
// while the actual crawling happens on a machine the server can't reach.

export const PIPELINE_STAGES = ["queued", "discover", "dedupe", "enrich", "score", "draft", "done"];

const pipelineRunSchema = new Schema(
  {
    kind: { type: String, enum: ["discovery", "deep_scan"], default: "discovery" },
    status: { type: String, enum: ["queued", "claimed", "running", "done", "failed"], default: "queued" },
    trigger: { type: String, enum: ["manual", "scheduled"], default: "manual" },

    options: {
      sources: [{ type: String }],
      perSource: { type: Number },
      enrich: { type: Boolean },
      useModelScoring: { type: Boolean },
      autoDraftTop: { type: Number },
      minDraftScore: { type: Number },
      // deep_scan jobs only
      domain: { type: String },
      companyName: { type: String },
      industry: { type: String },
    },

    // --- Live progress, written by the worker as it goes ---------------------
    // `stage` plus `note` is what the UI renders as "what's happening right
    // now"; without them a run is an opaque several-minute wait.
    stage: { type: String, enum: PIPELINE_STAGES, default: "queued" },
    note: { type: String },
    // 0-100, best-effort. Stage boundaries are known but per-site timing isn't,
    // so this is indicative rather than exact.
    percent: { type: Number, default: 0 },
    lastProgressAt: { type: Date },

    claimedBy: { type: String }, // worker id, so two workers can't run one job
    claimedAt: { type: Date },

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

// The worker claims the oldest queued job; this index keeps that a cheap
// lookup rather than a collection scan as run history builds up.
pipelineRunSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("PipelineRun", pipelineRunSchema);
