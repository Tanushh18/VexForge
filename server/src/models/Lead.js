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
      enum: ["manual", "website_scraper", "csv_import", "referral"],
      default: "manual",
    },
    sourceNote: { type: String },
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
