import mongoose from "mongoose";

const { Schema } = mongoose;

// A Playwright deep-scan run, triggered from the Admin page. Kept separate
// from the instant Cheerio scrape on the Leads page (Lead.source
// "website_scraper") since a headless-browser pass takes several seconds
// to tens of seconds and shouldn't hold an HTTP request open.
//
// Chromium lives on the local worker now, so this doubles as a job ticket:
// the Admin page creates it `queued`, the worker claims it on its next poll,
// and posts the result back. If no worker is running it simply stays queued,
// which is visible in the UI rather than silently failing.
const scrapeJobSchema = new Schema(
  {
    domain: { type: String, required: true },
    companyName: { type: String, required: true },
    industry: { type: String },
    status: { type: String, enum: ["queued", "claimed", "running", "done", "failed"], default: "queued" },
    claimedBy: { type: String },
    claimedAt: { type: Date },
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

// Matches the worker's claim query — keeps it an index hit as history grows.
scrapeJobSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("ScrapeJob", scrapeJobSchema);
