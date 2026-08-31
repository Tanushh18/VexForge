import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";

// The org chart: you (CEO) -> Head Manager -> one Manager per department ->
// a handful of worker agents per department. Everyone below "ceo" is an AI
// agent whose status/currentTask gets updated by real backend actions.
const CEO_NAME = process.env.CEO_NAME || "You";

const ORG = [
  { key: "ceo", name: CEO_NAME, title: "Founder & CEO", department: "Executive", level: "ceo", isHuman: true, reportsTo: null, avatarColor: "#ffffff", avatarInitial: CEO_NAME[0] },
  { key: "head", name: "Ember", title: "Head Manager (Chief of Staff)", department: "Executive", level: "head_manager", reportsTo: "ceo", avatarColor: "#ff7a2e", avatarInitial: "E", skills: ["coordination", "reporting", "chat console"] },

  { key: "ops_mgr", name: "Rhea", title: "Operations Manager", department: "Operations", level: "manager", reportsTo: "head", avatarColor: "#ef4f26", avatarInitial: "R", skills: ["pipeline", "outreach"] },
  { key: "ops_scout", name: "Scout", title: "Lead Scout", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "S", skills: ["lead sourcing", "website scraping"] },
  { key: "ops_drafter", name: "Quill", title: "Outreach Drafter", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "Q", skills: ["email drafting", "linkedin drafting"] },
  { key: "ops_coord", name: "Nova", title: "Pipeline Coordinator", department: "Operations", level: "agent", reportsTo: "ops_mgr", avatarColor: "#ff9c5c", avatarInitial: "N", skills: ["crm hygiene", "follow-ups"] },

  { key: "hr_mgr", name: "Priya", title: "HR Manager", department: "HR", level: "manager", reportsTo: "head", avatarColor: "#3f4a8a", avatarInitial: "P", skills: ["roster", "performance"] },
  { key: "hr_onboard", name: "Sage", title: "Onboarding Agent", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "S", skills: ["onboarding", "docs"] },
  { key: "hr_perf", name: "Wren", title: "Performance Tracker", department: "HR", level: "agent", reportsTo: "hr_mgr", avatarColor: "#6f79c9", avatarInitial: "W", skills: ["kpis", "reporting"] },

  { key: "tech_mgr", name: "Kabir", title: "Tech Manager", department: "Tech", level: "manager", reportsTo: "head", avatarColor: "#14804a", avatarInitial: "K", skills: ["infra", "site ops"] },
  { key: "tech_site", name: "Byte", title: "Website Ops Agent", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "B", skills: ["uptime", "deploys"] },
  { key: "tech_auto", name: "Circuit", title: "Automation Engineer", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "C", skills: ["n8n", "integrations"] },
  { key: "tech_qa", name: "Patch", title: "QA Agent", department: "Tech", level: "agent", reportsTo: "tech_mgr", avatarColor: "#3fb87f", avatarInitial: "P", skills: ["testing", "bug triage"] },

  { key: "fin_mgr", name: "Devika", title: "Finance Manager", department: "Finance", level: "manager", reportsTo: "head", avatarColor: "#c1521f", avatarInitial: "D", skills: ["quoting", "pipeline value"] },
  { key: "fin_quote", name: "Ledger", title: "Quote Builder", department: "Finance", level: "agent", reportsTo: "fin_mgr", avatarColor: "#e08a4f", avatarInitial: "L", skills: ["quotes", "invoices"] },
  { key: "fin_analyst", name: "Tally", title: "Pipeline Value Analyst", department: "Finance", level: "agent", reportsTo: "fin_mgr", avatarColor: "#e08a4f", avatarInitial: "T", skills: ["forecasting"] },

  { key: "sup_mgr", name: "Arjun", title: "Support Manager", department: "Support", level: "manager", reportsTo: "head", avatarColor: "#8b93a1", avatarInitial: "A", skills: ["call handling", "escalation"] },
  { key: "sup_agent1", name: "Echo", title: "Call & Feedback Agent", department: "Support", level: "agent", reportsTo: "sup_mgr", avatarColor: "#aeb4c0", avatarInitial: "E", skills: ["transcription", "resolution"] },
  { key: "sup_agent2", name: "Relay", title: "Ticket Resolver", department: "Support", level: "agent", reportsTo: "sup_mgr", avatarColor: "#aeb4c0", avatarInitial: "R", skills: ["triage", "follow-up"] },
];

export async function runSeed() {
  await connectDB();
  const existing = await Employee.countDocuments();
  if (existing > 0) {
    console.log(`[seed] ${existing} employees already exist — skipping. Drop the collection to reseed.`);
    return;
  }

  const idByKey = {};
  for (const person of ORG) {
    const doc = await Employee.create({
      name: person.name,
      title: person.title,
      department: person.department,
      level: person.level,
      isHuman: !!person.isHuman,
      avatarColor: person.avatarColor,
      avatarInitial: person.avatarInitial,
      skills: person.skills || [],
      reportsTo: null, // patched in second pass once all ids exist
      currentTask: person.isHuman ? "Running the company" : "Standing by",
    });
    idByKey[person.key] = doc._id;
  }

  for (const person of ORG) {
    if (!person.reportsTo) continue;
    await Employee.findByIdAndUpdate(idByKey[person.key], {
      reportsTo: idByKey[person.reportsTo],
    });
  }

  console.log(`[seed] created ${ORG.length} employees.`);
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
