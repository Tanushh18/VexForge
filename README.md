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
| AI drafting of outreach copy (email & LinkedIn) | Fully automated — runs on a **local Qwen2.5 model** via [VexForge-LocalLLM](../VexForge-LocalLLM), no paid API key |
| Sending **email** once you approve a draft | Automated *if* you configure SMTP — otherwise one click to open it in your mail client |
| Sending **LinkedIn** messages | **Never automated.** No tool here can log into LinkedIn or drive a browser to send anything, and doing so violates LinkedIn's Terms of Service and risks the account. Approving a LinkedIn draft gives you the message text + a one-click search link for the company; you paste and send it yourself. |
| Finding a company's contact email (fast path) | A narrow, low-risk scraper that only reads a company's *own* public homepage/contact/about pages for a listed email — no LinkedIn, no private directories, no bulk harvesting |
| Finding a company's contact email (JS-rendered sites) | The Admin · Deep Scan page runs the same lookup through a real headless browser (Playwright) for sites that render contact info client-side — only used as a fallback when the fast scan finds nothing |
| Cold-email sending | Sits in the approval queue by design — nothing goes out until you click Approve, per your earlier call to keep a human review step |
| Live phone calls / auto-transcription | Not wired up (needs your own Twilio number or similar). The Support page logs calls via pasted transcripts today; see "Extending" below for how to add live telephony |
| Voice input/output on the chatbot | Browser-native (Web Speech API) — works in Chrome/Edge, no extra service or key needed |
| Bulk lead import | CSV upload on the Leads page, with automatic duplicate rejection (by company name or website domain) |
| Contact enrichment | If you add a lead manually with a website but no email, a background scan fills the email in automatically when it finds one |
| Reply detection | *If* `IMAP_HOST` is configured, polls an inbox every 5 minutes and flips a lead to "responded" when someone from its `contactEmail` writes back |
| Follow-up nudges | A lead sitting in "outreach_sent" with no reply for `FOLLOWUP_AFTER_DAYS` (default 4) gets one automatic follow-up draft queued — same approval gate as any other draft |
| Ticket urgency tagging | Auto-classified from the transcript by the local model on ticket creation — a triage hint, not authoritative |
| Weekly digest | Auto-generated from the activity log once a week, shown on the Dashboard and pushed to Telegram if configured |
| Push notifications | *If* `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set: new draft ready, high-urgency ticket, ticket escalated, lead replied, weekly digest |

## Stack

- **server/** — Node + Express + MongoDB (Mongoose), JWT auth, Nodemailer for approved email sends,
  Cheerio/Axios for the fast contact scraper, Playwright for the JS-rendered deep-scan fallback. Talks to
  the local LLM over plain HTTP — no vendor SDK.
- **client/** — React + Vite, no UI framework — plain CSS matching the VexForge brand.
- **website/** — the public marketing site (your catalogue page) with a contact form that posts to the CRM as an opt-in lead.
- **[VexForge-LocalLLM](../VexForge-LocalLLM)** — a separate sibling project: Qwen2.5 running locally via
  Ollama, wrapped in a small REST API. This app is a client of that service (`LOCAL_LLM_URL`), not the
  other way around — see that project's own README to run/tunnel it.

## Project layout

```
VexForge-Automation/
├── client/                  React + Vite frontend
│   ├── src/
│   │   ├── pages/           Dashboard, Leads, Outreach, Support, Activity, Admin, Login
│   │   ├── components/      ChatWidget, OrgChart, ...
│   │   ├── hooks/
│   │   ├── services/        API client wrappers
│   │   └── AuthContext.jsx
│   └── vite.config.js
├── server/                  Express backend
│   ├── src/
│   │   ├── routes/          auth, employees, leads, outreach, tickets, activity, chat, public, admin, digest
│   │   ├── models/          Employee, Lead, OutreachMessage, Ticket, ActivityLog, ChatMessage, ScrapeJob, Digest
│   │   ├── services/        llmService, emailService, scraperService, notifyService, inboxService, followUpService, digestService, seed
│   │   ├── middleware/
│   │   └── config/
│   ├── test/                node:test unit tests for the pure/deterministic pieces
│   └── .env.example
├── website/                 Public marketing site (static HTML)
├── package.json             Root scripts (installs/runs server + client together)
└── README.md
```

## Prerequisites

- **Node.js 20+** and npm
- **MongoDB** — a local `mongod`, a Docker container, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- **[VexForge-LocalLLM](../VexForge-LocalLLM) running** (for the Ember chatbot + outreach drafting) — no
  paid API key, just Ollama + Qwen2.5 running locally. See that project's README to set it up; this app
  just needs `LOCAL_LLM_URL` pointed at it.
- **Playwright's Chromium** installed for the Admin deep-scan page: `npx playwright install chromium`
  (one-time, ~95MB download)
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

   # --- Chatbot (local Qwen model, via the separate VexForge-LocalLLM project) ---
   # No paid API key needed — run ../VexForge-LocalLLM and point this at it.
   LOCAL_LLM_URL=http://localhost:5001

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

   Only `MONGO_URI`, `JWT_SECRET`, and `CEO_EMAIL`/`CEO_PASSWORD` are required to run the app at all.
   `LOCAL_LLM_URL` is required for the chatbot and AI drafting specifically (the rest of the app works
   without it). SMTP and transcription are optional enhancements.

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

### Tests

```bash
npm test --prefix server           # node's built-in test runner, no extra dependency
```

Covers the deterministic, non-DB, non-network pieces: CSV parsing, lead-dedupe domain matching, the
chat intent router's keyword classification, email extraction, and the private-IP guard on the
scraper. These are exactly the parts most likely to silently regress since nothing else here would
catch it — everything DB/network-backed is exercised by using the app, not by these tests.

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
| `admin.js` | Playwright deep-scan jobs (queue, poll status) |
| `digest.js` | Latest/recent weekly digests |

## Using the chatbot (Ember)

Click the chat launcher (bottom-right) or use the mic button to speak a command. Ember runs on a small
local model (Qwen2.5-3B by default), so read commands are routed **deterministically in Node** (keyword
matching against your actual data — no free-form tool-picking) and the model is only asked to turn the
result into a fluent sentence. That trade-off buys reliability at the cost of scope: Ember answers
questions, it doesn't take actions from chat. Examples that work:

- "Give me a company status update."
- "What's the Operations team working on?"
- "List leads that are still new."
- "Show me the outreach queue awaiting approval."
- "What happened recently?" *(recent activity log)*

Adding a lead or drafting outreach is done through the CRM/Outreach pages' own forms, not chat — see
`server/src/services/llmService.js` for the router and the "why" behind that choice. Ember will never
claim to have sent a LinkedIn message — nothing here can send LinkedIn messages, automated or otherwise.

## Automation & notifications

Three background jobs run inside the server process on plain `setInterval` timers (see
`startBackgroundJobs` in `src/index.js`) — no separate worker or queue system needed at this scale:

| Job | Interval | What it does |
|---|---|---|
| Reply check | 5 min | Polls IMAP for unseen mail from a known lead's `contactEmail`; flips that lead + its sent `OutreachMessage` to "responded" |
| Follow-up check | 6 hr | Queues one follow-up draft per lead quiet for `FOLLOWUP_AFTER_DAYS` since their message was sent |
| Weekly digest | checked every 12 hr, runs once/week | Summarizes the last 7 days of the activity log via the local model |

All three are safe to leave unconfigured — `inboxService.imapConfigured()` gates the reply check,
and the others just find nothing to do without real data. Notifications (`notifyService.js`) are the
same story: every call is a no-op without `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` set.

To set up Telegram notifications: message [@BotFather](https://t.me/BotFather) on Telegram to create a
bot and get a token, send your new bot any message once, then fetch
`https://api.telegram.org/bot<token>/getUpdates` and read the chat id out of the response. Put both in
`server/.env`.

To set up reply detection: it defaults to your `SMTP_USER`/`SMTP_PASS` (same Gmail account, different
protocol/port) — set `IMAP_HOST` (and `IMAP_USER`/`IMAP_PASS` only if replies land in a different inbox
than you send from). A Gmail app password works for both SMTP and IMAP.

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
- `JWT_SECRET` and `CEO_PASSWORD` should be long, random values in any real deployment — required, not
  optional, the moment this is reachable from outside your own machine (e.g. behind a tunnel).
- The contact scraper only reads a company's own public pages — it does not touch LinkedIn or any
  authenticated/private source.
- Both scraper tiers refuse to scan a domain that resolves to a private/loopback/link-local address
  (`assertPublicHost` in `scraperService.js`) — the Playwright tier drives a full browser, which is a much
  bigger blast radius than a plain GET if pointed at something internal.
- `VexForge-LocalLLM`'s API has no auth — only run it on a private network, or behind a tunnel URL you
  don't share.
- Rate limiting (`express-rate-limit`) is on: a general ceiling on `/api/*` and a much tighter one on
  `/api/auth/login` specifically, since that's the credential-guessing target now that this can be
  reachable over a public tunnel.
