import mongoose from "mongoose";

const { Schema } = mongoose;

// A Playwright deep-scan run, triggered from the Admin page. Kept separate
// from the instant Cheerio scrape on the Leads page (Lead.source
// "website_scraper") since a headless-browser pass takes several seconds
// to tens of seconds and shouldn't hold an HTTP request open.
const scrapeJobSchema = new Schema(
  {
    domain: { type: String, required: true },
    companyName: { type: String, required: true },
    industry: { type: String },
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
    tier: { type: String, enum: ["static", "browser"] },
    result: {
      emails: [String],
      pagesOk: [String],
      pagesTried: [String],
    },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("ScrapeJob", scrapeJobSchema);
