import mongoose from "mongoose";

const { Schema } = mongoose;

// A prospect company — sourced either from a manual CSV/URL import or the
// public-website contact scraper. Nothing here implies consent to be
// contacted; that gate lives in the OutreachMessage approval workflow.
const leadSchema = new Schema(
  {
    companyName: { type: String, required: true },
    website: { type: String },
    industry: { type: String, default: "Unknown" },
    sizeGuess: {
      type: String,
      enum: ["micro (1-10)", "small (11-50)", "mid (51-200)", "unknown"],
      default: "unknown",
    },
    contactEmail: { type: String },
    contactName: { type: String },
    linkedinCompanyUrl: { type: String },
    source: {
      type: String,
      enum: ["manual", "website_scraper", "csv_import", "referral", "discovery"],
      default: "manual",
    },
    sourceNote: { type: String },
    // Which discovery adapter found this (product_hunt, hn_launches, ...) and
    // the public page it was found on, so any lead can be traced back to a
    // human-checkable URL rather than appearing from nowhere.
    discoverySource: { type: String },
    sourceUrl: { type: String },
    discoveredAt: { type: Date },
    // Scoring: `signals` are the deterministic facts observed about the lead,
    // `score` is computed from them (see scoringService), and `fitReason` is
    // the local reasoning model's optional one-line take. The score ranks the
    // outreach queue — it never authorizes a send on its own.
    signals: [{ type: String }],
    score: { type: Number, default: 0, index: true },
    scoreBand: { type: String, enum: ["hot", "warm", "cold"], default: "cold" },
    fitReason: { type: String },
    // What the worker proved about this lead before delivering it.
    verification: {
      siteOk: Boolean,
      siteTitle: String,
      emailOk: Boolean,
      mx: String,
      domainAgeDays: Number,
      seenIn: [String],
      verifiedAt: Date,
    },
    scoredAt: { type: Date },
    stage: {
      type: String,
      enum: [
        "new",
        "reviewed",
        "outreach_drafted",
        "outreach_sent",
        "responded",
        "call_booked",
        "won",
        "lost",
      ],
      default: "new",
    },
    notes: { type: String },
    addedBy: { type: Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

export default mongoose.model("Lead", leadSchema);
