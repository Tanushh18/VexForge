# VexForge HQ

An internal "AI company" console for VexForge: a live org chart across Operations, HR, Tech,
Finance and Support, a CRM/outreach pipeline with a human-approval gate, a call/feedback ticket
system, a full activity log, and a voice-enabled chatbot (Ember, the Head Manager) you command in
plain English. Includes the public marketing site with a working contact form wired into the CRM.

## Org structure

```
You (CEO)
 └─ Ember — Head Manager (Chief of Staff)
     ├─ Operations Manager (Rhea) → Lead Scout, Outreach Drafter, Pipeline Coordinator
     ├─ HR Manager (Priya) → Onboarding Agent, Performance Tracker
     ├─ Tech Manager (Kabir) → Website Ops, Automation Engineer, QA Agent
     ├─ Finance Manager (Devika) → Quote Builder, Pipeline Value Analyst
     └─ Support Manager (Arjun) → Call & Feedback Agent, Ticket Resolver
```

Every "agent" is a row in the database whose `status`/`currentTask` gets updated by real backend
actions (scraping a site, drafting a message, handling your chat command, etc.) — the dashboard
reflects what's actually happening, not a static picture. Seed/edit the roster in
`server/src/services/seed.js`.

## What's actually automated vs. what needs you

This matters, so it's not buried:

| Capability | Status |
|---|---|
| Org dashboard, CRM, ticket system, activity log | Fully automated, real-time |
| AI drafting of outreach copy (email & LinkedIn) | Fully automated (Claude) |
| Sending **email** once you approve a draft | Automated *if* you configure SMTP — otherwise one click to open it in your mail client |
| Sending **LinkedIn** messages | **Never automated.** No tool here can log into LinkedIn or drive a browser, and doing so violates LinkedIn's Terms of Service and risks the account. Approving a LinkedIn draft gives you the message text + a one-click search link for the company; you paste and send it yourself. |
| Finding a company's contact email | A narrow, low-risk scraper that only reads a company's *own* public homepage/contact/about pages for a listed email — no LinkedIn, no private directories, no bulk harvesting |
| Cold-email sending | Sits in the approval queue by design — nothing goes out until you click Approve, per your earlier call to keep a human review step |
| Live phone calls / auto-transcription | Not wired up (needs your own Twilio number or similar). The Support page logs calls via pasted transcripts today; see "Extending" below for how to add live telephony |
| Voice input/output on the chatbot | Browser-native (Web Speech API) — works in Chrome/Edge, no extra service or key needed |

## Stack

- **server/** — Node + Express + MongoDB (Mongoose), JWT auth, Anthropic SDK for the chatbot, Nodemailer for approved email sends, Cheerio/Axios for the contact scraper.
- **client/** — React + Vite, no UI framework — plain CSS matching the VexForge brand.
- **website/** — the public marketing site (your catalogue page) with a contact form that posts to the CRM as an opt-in lead.

## Project layout

```
VexForge-Automation/
├── client/                  React + Vite frontend
│   ├── src/
│   │   ├── pages/           Dashboard, Leads, Outreach, Support, Activity, Login
│   │   ├── components/      ChatWidget, OrgChart, ...
│   │   ├── hooks/
│   │   ├── services/        API client wrappers
│   │   └── AuthContext.jsx
│   └── vite.config.js
├── server/                  Express backend
│   ├── src/
│   │   ├── routes/          auth, employees, leads, outreach, tickets, activity, chat, public
│   │   ├── models/          Employee, Lead, OutreachMessage, Ticket, ActivityLog, ChatMessage
│   │   ├── services/        claudeService, emailService, scraperService, seed
│   │   ├── middleware/
│   │   └── config/
│   └── .env.example
├── website/                 Public marketing site (static HTML)
├── package.json             Root scripts (installs/runs server + client together)
└── README.md
```

## Prerequisites

- **Node.js 20+** and npm
- **MongoDB** — a local `mongod`, a Docker container, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- An **Anthropic API key** (for the Ember chatbot) — get one at [console.anthropic.com](https://console.anthropic.com)
- *(Optional)* SMTP credentials (e.g. a Gmail app password) if you want one-click email sending instead of opening drafts in your mail client

## Getting started

1. **Clone the repo**

   ```bash
   git clone git@github.com:Tanushh18/VexForge.git
   cd VexForge
   ```

2. **Install dependencies** (installs both `server/` and `client/`)

   ```bash
   npm run install:all
   ```

3. **Configure environment variables**

   ```bash
   cp server/.env.example server/.env
   ```

   Edit `server/.env`:

   ```ini
   # --- Core ---
   PORT=4000
   MONGO_URI=mongodb://127.0.0.1:27017/vexforge_hq
   JWT_SECRET=change_this_to_a_long_random_string
   CLIENT_ORIGIN=http://localhost:5173

   # CEO login (single admin account — you)
   CEO_EMAIL=you@vexforge.dev
   CEO_PASSWORD=change_this_password
   CEO_NAME=Your Name

   # --- Chatbot (Claude) ---
   # Required for the chat console (text + voice). Get a key at console.anthropic.com
   ANTHROPIC_API_KEY=

   # --- Email outreach (nodemailer) ---
   # Only used when YOU click "Send" on an approved draft — nothing sends automatically.
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=
   SMTP_PASS=
   SMTP_FROM_NAME=VexForge
   SMTP_FROM_EMAIL=

   # --- Optional: call transcription (OpenAI Whisper-compatible endpoint) ---
   # If unset, the Support page still works — you just paste transcripts in manually.
   TRANSCRIBE_API_KEY=
   TRANSCRIBE_API_URL=https://api.openai.com/v1/audio/transcriptions
   ```

   Only `MONGO_URI`, `JWT_SECRET`, `CEO_EMAIL`/`CEO_PASSWORD`, and `ANTHROPIC_API_KEY` are required
   to run the app. SMTP and transcription are optional enhancements.

4. **Start MongoDB** (skip if you're using Atlas)

   ```bash
   # local install
   mongod --dbpath /path/to/your/data/dir

   # or via Docker
   docker run -d -p 27017:27017 --name vexforge-mongo mongo:7
   ```

5. **Run the app** (server on `:4000`, client on `:5173`, concurrently)

   ```bash
   npm run dev
   ```

   First boot auto-seeds the org roster into MongoDB from `server/src/services/seed.js`.

6. **Open the app**

   Go to <http://localhost:5173> and sign in with the `CEO_EMAIL` / `CEO_PASSWORD` you set in
   `server/.env`.

### Running the public marketing site

Open `website/index.html` directly in a browser, or serve it with any static file server:

```bash
npx serve website
```

If the API isn't running on `localhost:4000`, set `window.VEXFORGE_API_BASE` in the page before
the script runs.

### Useful individual scripts

```bash
# Backend only
npm run dev --prefix server        # nodemon, auto-restart on changes
npm start --prefix server          # plain node, no watcher
npm run seed --prefix server       # re-seed the org roster manually

# Frontend only
npm run dev --prefix client        # Vite dev server
npm run build --prefix client      # production build
npm run preview --prefix client    # preview the production build
```

## API overview

All routes are mounted under `/api` on the server (`server/src/index.js`), backed by the route
files in `server/src/routes/`:

| Route file | Purpose |
|---|---|
| `auth.js` | CEO login, JWT issuance |
| `employees.js` | Org chart / agent roster CRUD, status + currentTask updates |
| `leads.js` | CRM leads (add, list, update) |
| `outreach.js` | AI-drafted outreach messages, approval queue, mark-sent |
| `tickets.js` | Support call/feedback tickets |
| `activity.js` | Company-wide activity log |
| `chat.js` | Ember chatbot command endpoint (text + voice transcripts) |
| `public.js` | Public contact form → CRM lead intake (used by `website/`) |

## Using the chatbot (Ember)

Click the chat launcher (bottom-right) or use the mic button to speak a command. Examples:

- "Give me a company status update."
- "What's the Operations team working on?"
- "List leads that are still new."
- "Add a lead: Acme Robotics, acme.example, contact priya@acme.example."
- "Draft a LinkedIn message for that lead."
- "Show me the outreach queue awaiting approval."
- "What happened in the last hour?" *(recent activity log)*

Ember has tools to read and act on real data (see `server/src/services/claudeService.js`), but it
will never claim to have sent a LinkedIn message — it can only draft and hand off to the approval
queue, consistent with the constraint above.

## Extending

- **Live calls/telephony**: wire Twilio Voice (or similar) to `POST /api/tickets` on call-end, and
  optionally pipe recordings through `TRANSCRIBE_API_URL` (already stubbed as an env var) to
  auto-fill `transcript`.
- **LinkedIn automation**: if you later set up a compliant tool (official LinkedIn API partnership,
  or a browser-automation tool you run and own), have it read approved drafts from
  `GET /api/outreach?status=approved&channel=linkedin` and call `POST /api/outreach/:id/mark-sent`
  once it actually sends — the queue and data model are already built for that handoff.
- **More departments/agents**: add entries to the `ORG` array in `server/src/services/seed.js`,
  wipe the `employees` collection, and restart.

## Security notes

- `server/.env` is git-ignored — never commit real credentials. Only `server/.env.example`
  (with placeholder values) is tracked.
- `JWT_SECRET` and `CEO_PASSWORD` should be long, random values in any real deployment.
- The contact scraper only reads a company's own public pages — it does not touch LinkedIn or any
  authenticated/private source.
