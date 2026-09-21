import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";

// The org chart: you (CEO) -> Head Manager -> one Manager per department ->
// a handful of worker agents per department. Everyone below "ceo" is an AI
// agent whose status/currentTask gets updated by real backend actions.
const CEO_NAME = process.env.CEO_NAME || "You";

// `modelRole` records which local model class actually runs this agent's work
// — see services/modelRouter.js. Managers reason, writers draft, and the
// bookkeeping agents stay on the small fast model so the UI stays responsive.
const ORG = [
  { key: "ceo", name: CEO_NAME, title: "Founder & CEO", department: "Executive", level: "ceo", isHuman: true, reportsTo: null, avatarColor: "#ffffff", avatarInitial: CEO_NAME[0], modelRole: "none" },
  { key: "head", name: "Ember", title: "Head Manager (Chief of Staff)", department: "Executive", level: "head_manager", reportsTo: "ceo", avatarColor: "#ff7a2e", avatarInitial: "E", modelRole: "reasoning", skills: ["coordination", "reporting", "chat console"] },

  { key: "ops_mgr", name: "Rhea", title: "Operations Manager", department: "Operations", level: "manager", reportsTo: "head", avatarColor: "#ef4f26", avatarInitial: "R", modelRole: "reasoning", skills: ["pipeline", "outreach"] },
  { key: "ops_scout", name: "Scout", title: "Lead Scout", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "S", modelRole: "fast", skills: ["lead sourcing", "website scraping", "playwright"] },
  { key: "ops_curator", name: "Atlas", title: "Source Curator", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "A", modelRole: "fast", skills: ["source health", "discovery config"] },
  { key: "ops_enrich", name: "Trace", title: "Enrichment Agent", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "T", modelRole: "fast", skills: ["contact lookup", "deep scan"] },
  { key: "ops_ranker", name: "Rank", title: "Lead Ranker", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "R", modelRole: "reasoning", skills: ["lead scoring", "fit assessment"] },
  { key: "ops_drafter", name: "Quill", title: "Outreach Drafter", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "Q", modelRole: "drafting", skills: ["email drafting", "linkedin drafting"] },
  { key: "ops_sentry", name: "Sentry", title: "Reply Watcher", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "S", modelRole: "fast", skills: ["inbox monitoring", "reply detection"] },
  { key: "ops_coord", name: "Nova", title: "Pipeline Coordinator", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "N", modelRole: "fast", skills: ["crm hygiene", "follow-ups"] },

  { key: "hr_mgr", name: "Priya", title: "HR Manager", department: "HR", level: "manager", reportsTo: "head", avatarColor: "#3f4a8a", avatarInitial: "P", modelRole: "reasoning", skills: ["roster", "performance"] },
  { key: "hr_onboard", name: "Sage", title: "Onboarding Agent", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "S", modelRole: "drafting", skills: ["onboarding", "docs"] },
  { key: "hr_perf", name: "Wren", title: "Performance Tracker", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "W", modelRole: "fast", skills: ["kpis", "reporting"] },
  { key: "hr_recruit", name: "Juno", title: "Recruiting Agent", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "J", modelRole: "drafting", skills: ["sourcing", "screening notes"] },
  { key: "hr_capacity", name: "Meridian", title: "Capacity Planner", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "M", modelRole: "reasoning", skills: ["workload", "staffing forecast"] },
  { key: "hr_policy", name: "Charter", title: "Policy & Docs Agent", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "C", modelRole: "drafting", skills: ["handbook", "sops"] },

  { key: "tech_mgr", name: "Kabir", title: "Tech Manager", department: "Tech", level: "manager", reportsTo: "head", avatarColor: "#14804a", avatarInitial: "K", modelRole: "reasoning", skills: ["infra", "site ops"] },
  { key: "tech_site", name: "Byte", title: "Website Ops Agent", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "B", modelRole: "fast", skills: ["uptime", "deploys"] },
  { key: "tech_auto", name: "Circuit", title: "Automation Engineer", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "C", modelRole: "drafting", skills: ["n8n", "integrations"] },
  { key: "tech_cloud", name: "Cirrus", title: "Cloud & Infra Agent", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "C", modelRole: "reasoning", skills: ["aws", "deployment"] },
  { key: "tech_data", name: "Vault", title: "Database Agent", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "V", modelRole: "reasoning", skills: ["schema design", "migrations"] },
  { key: "tech_qa", name: "Patch", title: "QA Agent", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "P", modelRole: "fast", skills: ["testing", "bug triage"] },

  { key: "fin_mgr", name: "Devika", title: "Finance Manager", department: "Finance", level: "manager", reportsTo: "head", avatarColor: "#c1521f", avatarInitial: "D", modelRole: "reasoning", skills: ["quoting", "pipeline value"] },
  { key: "fin_quote", name: "Ledger", title: "Quote Builder", department: "Finance", level: "agent", reportsTo: "fin_mgr", avatarColor: "#e08a4f", avatarInitial: "L", modelRole: "drafting", skills: ["quotes", "invoices"] },
  { key: "fin_analyst", name: "Tally", title: "Pipeline Value Analyst", department: "Finance", level: "agent", reportsTo: "fin_mgr", avatarColor: "#e08a4f", avatarInitial: "T", modelRole: "reasoning", skills: ["forecasting"] },
  { key: "fin_invoice", name: "Mint", title: "Invoicing & Collections Agent", department: "Finance", level: "agent", reportsTo: "fin_mgr", avatarColor: "#e08a4f", avatarInitial: "M", modelRole: "fast", skills: ["invoicing", "reminders"] },

  { key: "sup_mgr", name: "Arjun", title: "Support Manager", department: "Support", level: "manager", reportsTo: "head", avatarColor: "#8b93a1", avatarInitial: "A", modelRole: "reasoning", skills: ["call handling", "escalation"] },
  { key: "sup_agent1", name: "Echo", title: "Call & Feedback Agent", department: "Support", level: "agent", reportsTo: "sup_mgr", avatarColor: "#aeb4c0", avatarInitial: "E", modelRole: "fast", skills: ["transcription", "resolution"] },
  { key: "sup_agent2", name: "Relay", title: "Ticket Resolver", department: "Support", level: "agent", reportsTo: "sup_mgr", avatarColor: "#aeb4c0", avatarInitial: "R", modelRole: "fast", skills: ["triage", "follow-up"] },
  { key: "sup_kb", name: "Archive", title: "Knowledge Base Agent", department: "Support", level: "agent", reportsTo: "sup_mgr", avatarColor: "#aeb4c0", avatarInitial: "A", modelRole: "drafting", skills: ["faq", "help docs"] },
];

// Upserts by title rather than bailing when the collection is non-empty. The
// old behaviour meant adding an agent to this list did nothing until you
// dropped the whole `employees` collection — which also threw away every
// agent's accumulated tasksCompleted count. Titles are the stable identity
// here; live fields (status, currentTask, tasksCompleted) are never touched.
export async function runSeed() {
  await connectDB();

  const idByKey = {};
  let created = 0;
  let updated = 0;

  for (const person of ORG) {
    const existing = await Employee.findOne({ title: person.title });
    const definition = {
      name: person.name,
      title: person.title,
      department: person.department,
      level: person.level,
      isHuman: !!person.isHuman,
      avatarColor: person.avatarColor,
      avatarInitial: person.avatarInitial,
      modelRole: person.modelRole || "fast",
      skills: person.skills || [],
    };

    if (existing) {
      await Employee.findByIdAndUpdate(existing._id, definition);
      idByKey[person.key] = existing._id;
      updated += 1;
    } else {
      const doc = await Employee.create({
        ...definition,
        reportsTo: null, // patched in second pass once all ids exist
        currentTask: person.isHuman ? "Running the company" : "Standing by",
      });
      idByKey[person.key] = doc._id;
      created += 1;
    }
  }

  for (const person of ORG) {
    if (!person.reportsTo) continue;
    await Employee.findByIdAndUpdate(idByKey[person.key], {
      reportsTo: idByKey[person.reportsTo],
    });
  }

  console.log(`[seed] roster synced — ${created} created, ${updated} updated (${ORG.length} total).`);
}

// Allow `npm run seed` to run this directly.
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  runSeed()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
