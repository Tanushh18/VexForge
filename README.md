# VexForge HQ

An internal "AI company" console for VexForge, running entirely on local models: an end-to-end
lead-generation pipeline (discover → enrich → score → draft), a live org chart across Operations,
HR, Tech, Finance and Support, a CRM/outreach queue with a human-approval gate and a daily send
cap, a call/feedback ticket system, a full activity log, and a voice-enabled chatbot (Ember, the
Head Manager) you command in plain English. Includes the public marketing site with a working
contact form wired into the CRM.

## Architecture: two processes

VexForge runs as **two** processes, not one, and the split is forced by memory:

```
  YOUR MACHINE                           DEPLOYED (512MB is plenty)
  ┌───────────────────────┐              ┌──────────────────────────┐
  │ worker/               │  poll ──────►│ server/  ~140MB idle     │
  │  • Playwright ~730MB  │              │  • CRM, dedupe, storage  │
  │  • discovery          │  leads ─────►│  • approval queue        │
  │  • contact enrichment │  progress ──►│  • sending (daily cap)   │
  │  • scoring            │              │  • reply detection       │
  │  • drafting           │              │  • follow-ups, digests   │
  │ Ollama 2-16GB         │◄── tunnel ───│  • chat (needs a model)  │
  └───────────────────────┘              └──────────────────────────┘
                                          client/ + website/ (static)
```

**Why Playwright can't be tunnelled.** Ollama is an HTTP service, so the
deployed server reaches it over a tunnel with one env var. Playwright is an
*in-process library* — there's no port to point at — so whatever drives the
browser has to live where the browser is. That's the worker.

The worker never touches the database. It posts leads to the API, which owns
dedupe: a second implementation of that rule is exactly how the same company
ends up in the CRM twice. It also **can't send anything** — the approval gate
and the send cap are both server-side, behind an auth the worker doesn't hold.

One upside of drafting on the worker: Ollama is on *localhost* there, so
drafts can't silently go missing the way they would if the server had to reach
a model across a tunnel that happened to be down.

See **[worker/README.md](worker/README.md)** to run it.

## The lead pipeline

This is the part that finds you clients. One run, six stages:

```
1. Discover   20 public listing sites → company name, website, timing signals
2. Enrich     find a contact email on the company's OWN site (static pass, then a
              headless browser only if that comes back empty)
3. Filter     MANDATORY — a lead with no email after full enrichment is dropped,
              never reaches the CRM. See "Contact is mandatory" below.
4. Score      deterministic signal weights, then a ±15 adjustment from the local
              reasoning model — see shared/scoring.js
5. Draft      outreach for the top N scoring leads that made it past the filter
6. Deliver    POST to the API, which dedupes against the CRM and stores
```

Stages 1-5 run on the worker; stage 6 is where the deployed side takes over.

### 20 discovery sources, two fetch strategies in rotation

| Fetch strategy | Count | Sources |
|---|---|---|
| **Direct** (HTTP/API, no browser) | 3 | Hacker News launches (Algolia API), Reddit launches (r/startups, r/SaaS — Reddit's public `.json` API), Funding news (Google News RSS) |
| **Playwright** (client-rendered listings) | 17 | Product Hunt, Y Combinator directory, plus 15 launch/directory/hiring boards — BetaList, BetaPage, Indie Hackers, SaaSHub, F6S, StartupRanking, Launching Next, DevHunt, Peerlist, Wellfound, LibHunt, OpenAlternative, AlternativeTo, Uneed, Microlaunch |

The 15 Playwright sources share **one generic harvester**
(`worker/src/leadSources/genericDirectory.js`) rather than 15 bespoke
per-site scrapers: it collects every outbound `<a href>` on a listing page and
its link text as a company-name candidate, filtering out social/platform
links and UI chrome ("Visit", "Sign up", …). That's the same technique
already used for Product Hunt and YC — match by link *shape*, not a specific
CSS class — generalized so one well-tested extractor backs many configs. Each
site is just a `{key, url, platformHosts}` entry in
`worker/src/leadSources/directorySites.js`; a listing that's moved or added a
login wall returns 0 results rather than breaking the run (`safeSource()`
isolates every source's failures from the rest).

**Runs rotate through the 20 rather than crawling all of them every time** —
a polite, sequential 20-site crawl in one sitting is a long run and a lot of
load on sites you don't want to look like a bot to. `PIPELINE_ROTATION_BATCH_SIZE`
(default 8) sources are picked per run, off a cursor persisted in the
database (`Settings.rotationCursor`) that advances every run — so the full 20
get covered roughly every 3 runs without you tracking which sources ran
recently. Rotation only applies when you *don't* explicitly choose sources:
checking specific boxes on the Lead Pipeline page always runs exactly those;
the "Run next batch (rotation)" button and the scheduled job both omit an
explicit list and get the next slice off the cursor.

### Contact is mandatory

A lead with no email after the full tiered enrichment pass — static site
scan, then a headless-browser fallback if that found nothing — **never
reaches the CRM.** `worker/src/pipeline.js`'s `partitionByContact()` drops it
before scoring or drafting; a company you can't reach isn't a prospect to
review later, it's dead weight in the pipeline.

This has one real consequence: **Funding News leads almost never survive.**
A headline like "Acme raises $2M" names a company but not which of several
plausible domains is really theirs — guessing wrong risks enriching (or
emailing) the wrong company, so that source deliberately produces no
`website` at all. With no domain to scrape, enrichment can't run, so these
get dropped by the mandatory filter as designed. The source stays in
rotation because `just_funded` is the single highest-weighted scoring signal
when a lead *does* survive — but expect a low hit rate from it specifically.

**The pipeline stops at `draft`.** Nothing in it can send. Every message still
passes the approval gate, and the send path is capped at `DAILY_SEND_CAP`
(25/day by default) — a new sending domain that fires a hundred cold emails in
an afternoon gets classified as spam, and that reputation then follows every
later message.

Click **Start run** on the Lead Pipeline page and the job is queued; the worker
picks it up on its next poll and reports progress as it goes, so the page shows
the live stage and the company being worked on rather than a blank several
minutes. If no worker is online the page says exactly that, instead of leaving
a job to look mysteriously stuck.

### Scoring

Signals are observed facts; weights are in `SIGNAL_WEIGHTS`. Base score is 30.

| Signal | Weight | Why |
|---|---|---|
| `just_funded` | +30 | budget exists, and it's new |
| `just_launched` | +25 | needs a site/infra now, before a vendor is entrenched |
| `has_contact_email` | +20 | without it there's no outreach path at all |
| `hiring` | +15 | growing, often with unmet build capacity |
| `target_industry` | +12 | matches what VexForge has already shipped |
| `has_founder_name` | +8 | a personalized first line lands better than "Hi there" |
| `has_website` | +5 | |
| `no_contact_path` | −20 | no email, and no site to find one on |
| `too_large` | −15 | enterprise procurement isn't this studio's lane |
| `agency_or_competitor` | −25 | another studio isn't a client |

Bands: **hot** ≥ 70, **warm** ≥ 45, **cold** below. The reasoning model can re-rank *within* the
deterministic result but is clamped to ±15 — it cannot promote a cold lead to hot, and it cannot
overrule a missing contact path. If no model is running, scoring still works; you just lose the
adjustment.

### What each source does and doesn't touch

Every adapter reads **public listing pages only** and takes nothing but a company name, a website
and a description. Contact details never come from these sites — they come from each company's own
homepage/contact/about pages in the enrichment step, exactly as they do for a lead you add by hand.
No LinkedIn, no login-gated directories, no bulk harvesting, and a sequential one-page-at-a-time
crawl rather than a parallel scraper farm.

One exception worth calling out: **funding-news leads carry no `website` field.** A headline like
"Acme raises $2M" identifies the company but not which of several plausible domains is really
theirs, so guessing one would risk enriching (or emailing) the wrong company. These leads still
score — `just_funded` is the single highest-weighted signal — but sit with the `no_contact_path`
penalty until you find the domain yourself, or a later scan on the Leads/Admin page fills it in.

## Local models

Everything runs on a local [Ollama](https://ollama.com). No paid API key anywhere. Work is routed
to one of three models by *role*, because asking one small model to do everything is how you get
bad decisions and slow UIs both:

| Role | Default model | Used for |
|---|---|---|
| `reasoning` | `qwen2.5:14b-instruct` | lead scoring and fit assessment, ticket triage, weekly digests — anything that changes what the pipeline does |
| `drafting` | `qwen2.5:7b-instruct` | outreach copy and follow-ups |
| `fast` | `qwen2.5:3b-instruct` | classification, chatbot replies, one-line summaries |

```bash
ollama pull qwen2.5:14b-instruct   # the decision-maker — needs ~10GB free
ollama pull qwen2.5:7b-instruct
ollama pull qwen2.5:3b-instruct
```

On a smaller machine, set `OLLAMA_MODEL_ALL=qwen2.5:7b-instruct` to collapse all three roles onto
one model. If a role's model isn't pulled, the router falls back down the size ladder rather than
failing — a lead scored by the 3B model beats no scored lead at all, and **Admin · System** shows
you which model each role actually resolved to.

The older [VexForge-LocalLLM](../VexForge-LocalLLM) sibling service still works as a backend
(`LLM_BACKEND=localllm`, or `auto` which prefers Ollama and falls back to it).

## Org structure

```
You (CEO)
 └─ Ember — Head Manager (Chief of Staff)
     ├─ Operations Manager (Rhea) → Lead Scout, Source Curator, Enrichment Agent,
     │                              Lead Ranker, Outreach Drafter, Reply Watcher,
     │                              Pipeline Coordinator
     ├─ HR Manager (Priya) → Onboarding Agent, Performance Tracker, Recruiting Agent,
     │                       Capacity Planner, Policy & Docs Agent
     ├─ Tech Manager (Kabir) → Website Ops, Automation Engineer, Cloud & Infra Agent,
     │                         Database Agent, QA Agent
     ├─ Finance Manager (Devika) → Quote Builder, Pipeline Value Analyst,
     │                             Invoicing & Collections Agent
     └─ Support Manager (Arjun) → Call & Feedback Agent, Ticket Resolver,
                                  Knowledge Base Agent
```

Every "agent" is a row in the database whose `status`/`currentTask` gets updated by real backend
actions (crawling a source, scoring a batch, drafting a message, handling your chat command) — the
dashboard reflects what's actually happening, not a static picture. Each one also carries a
`modelRole` recording which of the three local models its work actually runs on, so the org chart
documents the real routing rather than being decoration.

Edit the roster in `server/src/services/seed.js`. The seed **upserts by title**, so adding an agent
to that list and restarting is enough — you no longer have to drop the `employees` collection,
which used to throw away every agent's accumulated `tasksCompleted` count.

## What's actually automated vs. what needs you

This matters, so it's not buried:

| Capability | Status |
|---|---|
| Org dashboard, CRM, ticket system, activity log | Fully automated, real-time |
| **Finding new leads** (discovery) | Fully automated — Playwright + a public API across three sources, on demand or on a daily schedule. Public listing pages only. |
| **Lead scoring & ranking** | Fully automated — deterministic signal weights plus a clamped ±15 adjustment from the local reasoning model. Works with no model running. |
| **Auto-drafting for top leads** | Fully automated — the pipeline drafts for the top N scoring leads that have an email. Every draft still lands in the approval queue. |
| **Daily send cap** | Enforced — `DAILY_SEND_CAP` (25/day) on automated SMTP sends. Marking a message sent by hand doesn't count against it, since that's you sending from your own client. |
| AI drafting of outreach copy (email & LinkedIn) | Fully automated — runs on **local models via Ollama**, no paid API key |
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
  Cheerio/Axios for the fast contact scraper, Playwright for lead discovery and the JS-rendered
  deep-scan fallback. Talks to Ollama over plain HTTP — no vendor SDK.
- **client/** — React + Vite, no UI framework — plain CSS matching the VexForge brand.
- **website/** — the public marketing site (your catalogue page) with a contact form that posts to the CRM as an opt-in lead.
- **[Ollama](https://ollama.com)** — runs the three local models. Nothing else is required; the older
  [VexForge-LocalLLM](../VexForge-LocalLLM) sibling service remains supported as an alternate backend.

## Project layout

```
VexForge-Automation/
├── client/                  React + Vite frontend
│   ├── src/
│   │   ├── pages/           Dashboard, Pipeline, Leads, Outreach, Support, Activity, Admin, Login
│   │   ├── components/      ChatWidget, OrgChart, ...
│   │   ├── hooks/
│   │   ├── services/        API client wrappers
│   │   └── AuthContext.jsx
│   └── vite.config.js
├── shared/                  Imported by BOTH server and worker — no dependencies
│   ├── modelRouter.js       role → local model routing (the only place a model is named)
│   ├── scoring.js           deterministic signal weights + the clamped model adjustment
│   └── outreach.js          the draft prompts
├── worker/                  LOCAL ONLY — the half that needs a browser and a GPU
│   ├── src/
│   │   ├── index.js         poll loop (`npm start`) / one-shot (`npm run once`)
│   │   ├── apiClient.js     talks to the deployed API with a worker key
│   │   ├── pipeline.js      the run: discover → enrich → score → draft → deliver
│   │   ├── leadSources/     one module per discovery source
│   │   └── scraper.js       contact lookup, static pass then browser fallback
│   └── .env.example
├── server/                  Express backend — deployed, no Playwright
│   ├── src/
│   │   ├── routes/          auth, employees, leads, outreach, tickets, activity, chat, public, admin, digest, pipeline
│   │   ├── models/          Employee, Lead, OutreachMessage, Ticket, ActivityLog, ChatMessage, ScrapeJob, Digest, PipelineRun
│   │   ├── services/
│   │   │   ├── pipelineQueue.js     queues runs for the worker to claim
│   │   │   ├── leadIngestService.js takes the worker's leads, dedupes, stores
│   │   │   ├── workerRegistry.js    which workers have checked in recently
│   │   │   ├── contactScraper.js    the static-only tier (no Playwright here)
│   │   │   ├── leadRepository.js    lead identity + dedupe, shared by every create path
│   │   │   ├── sendQuotaService.js  the daily send cap
│   │   │   ├── jobRegistry.js       every recurring job, its schedule, and its last outcome
│   │   │   └── llmService, emailService, notifyService, inboxService,
│   │   │       followUpService, digestService, seed
│   │   ├── middleware/      auth (JWT, console) + workerAuth (key, worker)
│   │   └── config/
│   ├── test/                node:test unit tests for the pure/deterministic pieces
│   ├── Dockerfile           builds from the REPO ROOT so shared/ is included
│   └── .env.example
├── website/                 Public marketing site (static HTML)
├── package.json             Root scripts (installs/runs server + client together)
└── README.md
```

## Prerequisites

- **Node.js 20+** and npm
- **MongoDB** — a local `mongod`, a Docker container, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- **[Ollama](https://ollama.com) running**, with the three models pulled (see "Local models" above).
  No paid API key. The app runs without it — you just lose drafting, model scoring and the chatbot.
- **Playwright's Chromium**, *on the worker machine only*: `npx playwright install chromium`
  (one-time, ~95MB). The deployed server never needs it.
- *(Optional)* SMTP credentials (e.g. a Gmail app password) if you want one-click email sending instead of opening drafts in your mail client

## Getting started

1. **Clone the repo**

   ```bash
   git clone git@github.com:Tanushh18/VexForge.git
   cd VexForge
   ```

2. **Install dependencies** (installs both `server/` and `client/`)

   ```bash
   npm run install:all     # server + client + worker
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

   # --- Local models (Ollama) — no paid API key ---
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL_REASONING=qwen2.5:14b-instruct
   OLLAMA_MODEL_DRAFTING=qwen2.5:7b-instruct
   OLLAMA_MODEL_FAST=qwen2.5:3b-instruct
   # On a smaller machine, collapse all three roles onto one model instead:
   # OLLAMA_MODEL_ALL=qwen2.5:7b-instruct

   # --- Lead pipeline ---
   DAILY_SEND_CAP=25              # hard ceiling on automated cold emails per day
   PIPELINE_PER_SOURCE=12         # companies pulled from each source per run
   PIPELINE_AUTO_DRAFT_TOP=5      # how many top leads get a draft queued (never sent)
   PIPELINE_MIN_DRAFT_SCORE=60    # score floor before the pipeline will draft at all
   PIPELINE_SCHEDULE_ENABLED=false # run the pipeline daily; off by default

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
   Ollama is required for the chatbot, AI drafting and model-assisted scoring specifically — lead
   discovery, deterministic scoring and the rest of the app all work without it. SMTP and
   transcription are optional enhancements.

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

7. **Start the worker** (a second terminal — this is what actually crawls)

   ```bash
   cp worker/.env.example worker/.env     # set VEXFORGE_API_URL + WORKER_API_KEY
   npm run worker
   ```

   `WORKER_API_KEY` must match the one in `server/.env` exactly — the server fails closed with a
   503 until both sides have it, because an unset key must never mean "anyone may post leads into
   the CRM". Generate one with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Without the worker running, the console still works and you can still add leads by hand — but
   "Start run" just queues a job that nothing picks up, and the Pipeline page will tell you so.

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
npm test                           # both packages
npm test --prefix server           # API, scoring, worker auth, CORS parsing
npm test --prefix worker           # discovery source parsing, contact extraction
```

Covers the deterministic, non-DB, non-network pieces: CSV parsing, lead-dedupe domain matching, the
chat intent router's keyword classification, email extraction, the private-IP guard on the scraper,
the full scoring model (signal detection, band thresholds, and the clamp that stops the model
promoting a cold lead to hot), each discovery source's title/link parsing, and the lenient JSON
parser that keeps a chatty model from breaking a scoring run.

These are exactly the parts most likely to silently regress since nothing else here would catch it
— everything DB/network-backed is exercised by using the app, not by these tests.

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
| `admin.js` | Playwright deep-scan jobs, local-model health, background-job status |
| `digest.js` | Latest/recent weekly digests |
| `pipeline.js` | Lead pipeline — list sources, trigger a run, poll run status, funnel snapshot |

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

Background jobs are declared in one place — `src/services/jobRegistry.js` — rather than as loose
`setInterval` calls. The registry records each job's schedule, last run time and last outcome, and
`GET /api/admin/jobs` reports it; previously the only way to find out whether a job had ever run
was to read the server log. **Admin · System** shows the table and has a "Run now" button per job.

| Job | Interval | What it does |
|---|---|---|
| Reply check | 5 min | Polls IMAP for unseen mail from a known lead's `contactEmail`; flips that lead + its sent `OutreachMessage` to "responded" |
| Follow-up check | 6 hr | Queues one follow-up draft per lead quiet for `FOLLOWUP_AFTER_DAYS` since their message was sent |
| Weekly digest | checked every 12 hr, runs once/week | Summarizes the last 7 days of the activity log via the reasoning model |
| Lead pipeline | 24 hr, **off by default** | The full discover → enrich → score → draft run. Enable with `PIPELINE_SCHEDULE_ENABLED=true`. |

All are safe to leave unconfigured — `inboxService.imapConfigured()` gates the reply check, the
pipeline job is opt-in, and the others just find nothing to do without real data. Notifications
(`notifyService.js`) are the same story: every call is a no-op without
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` set.

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
- **More departments/agents**: add entries to the `ORG` array in `server/src/services/seed.js` and
  restart — the seed upserts by title, so nothing needs wiping. Give each new agent a `modelRole`
  (`reasoning` / `drafting` / `fast` / `none`).
- **More lead sources**: add one module to `server/src/services/leadSources/` exporting
  `{ key, label, needsBrowser, run }` and list it in that folder's `index.js`. It should return
  partial leads (`companyName`, `website`, `notes`, `sourceUrl`, `signals`) and read public pages
  only; dedupe, enrichment and scoring are handled for you downstream.
- **Deploying the pipeline off your laptop**: the server is a plain Node process with a Mongo URI
  and an Ollama URL, so a small EC2 instance (or any always-on box) runs it unchanged — point
  `MONGO_URI` at Atlas and `OLLAMA_URL` at wherever the models live. The `reasoning` model is the
  one that needs real RAM; everything else is comfortable on a modest instance.

## What fits where (memory)

The pieces of this project have wildly different footprints, and only some of them can share a box.
Measured on this codebase; model figures are Ollama's default Q4_K_M quantization.

| Component | RAM | Where it can live |
|---|---|---|
| React console (`client/`) | none at runtime | any static host — it's just files |
| Marketing site (`website/`) | none at runtime | any static host |
| Node API, idle | **~140 MB** | a 512MB instance, comfortably |
| **+ Playwright Chromium** during a run | **+600–730 MB** | needs ~1GB free; this is the spike that decides your plan |
| MongoDB | not your RAM | Atlas free tier (512MB *storage*) |
| `qwen2.5:3b-instruct` (`fast`) | ~2 GB | a laptop, easily |
| `qwen2.5:7b-instruct` (`drafting`) | ~5 GB | 16GB machine, fine |
| `qwen2.5:14b-instruct` (`reasoning`) | ~9 GB | 16GB machine, tight; 32GB comfortable |

### The trap: Ollama keeps all three models loaded

Ollama holds up to three models resident at once by default and only evicts them after ~5 minutes
idle. This app uses all three roles, so a single pipeline run touches all three back to back — and
you can end up with **~16GB of models resident simultaneously**, on top of everything else. On a
16GB machine that means swapping, and swapping a 9GB model is indistinguishable from a hang.

Two ways out, depending on the machine:

```bash
# 32GB+ : leave it — keeping models warm is exactly what you want
# 16GB  : one model at a time. Slower (a role switch reloads from disk), never swaps.
OLLAMA_MAX_LOADED_MODELS=1

# <16GB : collapse all three roles onto one model — no reloads, no eviction
OLLAMA_MODEL_ALL=qwen2.5:7b-instruct
```

### Deployable as-is vs. not

- **Deploy anywhere:** both static sites, and the Node API — it's a plain Express process.
- **Deploy with room to breathe:** the API *including* discovery and deep scans. Budget ~1GB;
  Chromium is the whole reason.
- **Don't deploy to a normal cloud instance:** the models. A 14B model on a CPU-only box isn't
  memory-bound so much as unusably slow — seconds per token. Keep Ollama on hardware you control
  and point `OLLAMA_URL` at it.

Splitting is a legitimate answer: static sites on a free host, the API on a small instance, and
Ollama on your own machine behind a tunnel. The router degrades cleanly when the models are
unreachable, so the split never takes the app down — it just narrows what it can do.

## Rollout phases — what runs where, and when to move

The split isn't local-vs-cloud so much as **workload-vs-uptime**. Two facts drive it:

- The models need RAM and speed, so they stay on hardware you own.
- Reply detection, follow-ups and the contact form only work if something is always on.

The lever that makes this cheap: **both the local and the deployed API talk to the same Atlas
database.** So Chromium — the single biggest memory cost — can keep running on your laptop long
after the rest is deployed, writing into the same CRM. You don't pay for a 2GB instance until you
actually want discovery running unattended.

### Phase 0 — everything local

| | |
|---|---|
| **Local** | MongoDB, Ollama + all 3 models, API, console, marketing site |
| **Deployed** | nothing |
| **Settings** | `PIPELINE_SCHEDULE_ENABLED=false` — trigger every run by hand |

```bash
npm run install:all && npx playwright install chromium
cp server/.env.example server/.env    # fill in MONGO_URI, JWT_SECRET, CEO_*
npm run dev
```

The point of this phase is to find out whether the discovery sources actually surface companies
worth emailing — **before** paying for anything. Watch a full run from the Lead Pipeline page, then
read the top 10 in the CRM and ask whether you'd genuinely contact them. If Product Hunt's markup
has shifted or the scoring is mis-ranking, you want to learn that for free.

**Move on when:** a manual run produces leads you'd actually email, and the drafts read like
something you'd send.

### Phase 1 — deploy the shopfront, keep the heavy work local

| | |
|---|---|
| **Local** | Ollama + models, **and the pipeline runs** (Chromium stays on your machine) |
| **Deployed** | Marketing site, console, API — on a **512MB Starter instance** |
| **Database** | Atlas, shared by both your laptop and the deployed API |
| **Settings** | `PIPELINE_SCHEDULE_ENABLED=false` on the deployed instance |

Change `plan: standard` to `plan: starter` in `render.yaml` for this phase. 512MB is plenty for
everything **except** Chromium — and Chromium isn't running there yet, because you're still
triggering pipeline runs from your laptop against the same Atlas cluster.

What the deployed side buys you immediately: the contact form goes live, the CRM is reachable from
your phone, and IMAP reply detection runs around the clock — that one needs no model at all, so it
works whether or not your laptop is on.

What still needs your machine awake: drafting, the chatbot, follow-up generation and the weekly
digest, since all four need Ollama. Point `OLLAMA_URL` at your desktop through a Cloudflare tunnel
and they work whenever it's up.

**Move on when:** you're tired of remembering to trigger runs manually.

### Phase 2 — hand discovery to the cloud

| | |
|---|---|
| **Local** | Ollama + models only (tunnelled) |
| **Deployed** | Everything else, now including discovery |
| **Settings** | `plan: standard` (2GB, for Chromium) · `PIPELINE_SCHEDULE_ENABLED=true` |

This is the autonomous configuration: it discovers, enriches, scores and drafts on a 24-hour cycle,
and you review the approval queue whenever you feel like it.

**Know this before you flip it.** If the deployed API can't reach Ollama — laptop closed, tunnel
down — a scheduled run still discovers, dedupes, enriches and scores, because deterministic scoring
needs no model. But **drafting produces nothing for that batch and nothing retries it later.** Those
leads sit at `new` with no draft. `POST /api/leads/rescore` catches scoring up; there is no
equivalent for drafting yet, so today you'd generate those one at a time from the Outreach page.

If your Ollama host isn't reliably on, stay on Phase 1 — a nightly run whose drafts silently go
missing is worse than one you trigger yourself.

### At a glance

| Component | Phase 0 | Phase 1 | Phase 2 |
|---|---|---|---|
| Marketing site | local | **deployed** | deployed |
| Console (`client/`) | local | **deployed** | deployed |
| API | local | **deployed** (512MB) | deployed (2GB) |
| MongoDB | local | **Atlas** | Atlas |
| Pipeline / Chromium | local | local | **deployed** |
| Ollama + models | local | local (tunnelled) | local (tunnelled) |
| Scheduled runs | off | off | **on** |

## Deploying to Render

`render.yaml` in the repo root is a Blueprint for all three services: the API (Docker, since lead
discovery drives a real Chromium), the HQ console, and the public marketing site. In Render:
**New → Blueprint**, point it at this repo, and fill in the variables it asks for.

Two pieces Render can't host, both wired as dashboard-entered variables:

| Variable | Why it's external |
|---|---|
| `MONGO_URI` | Render has no managed MongoDB — use a free [Atlas](https://www.mongodb.com/atlas) cluster. Atlas blocks unknown IPs, so allowlist Render's outbound IPs (Service → Connect → Outbound). |
| `OLLAMA_URL` | Render's standard instances are CPU-only, and a 14B model on CPU is far too slow to sit in a request path. Point this at a machine you control — your desktop behind a Cloudflare tunnel, or a GPU box. |

**Without Ollama the app still runs.** Discovery, enrichment, dedupe and deterministic scoring all
keep working; you lose drafting, the chatbot, and the model's ±15 scoring adjustment. **Admin ·
System** shows which roles actually resolved, so you can tell "not running" from "not pulled".

Three things worth knowing before you click deploy:

- **The API is on Starter, not Free, deliberately.** Free instances spin down when idle, and a
  spun-down instance runs no background jobs — no reply checking, no follow-up drafting, no
  scheduled pipeline. A lead-gen system that only works while a tab is open isn't one.
- **One manual step.** Both static sites proxy `/api/*` to the API by absolute URL, and Render only
  knows that URL once the API exists. If your API lands on a hostname other than
  `vexforge-api.onrender.com`, update the three `destination:` lines in `render.yaml` and redeploy
  the static sites.
- **`PIPELINE_SCHEDULE_ENABLED` ships as `false`.** Watch one manual run from the Lead Pipeline page
  first, then flip it in the dashboard.

`autoDeploy` is off for all three services — push doesn't redeploy until you say so.

## Security notes

- `server/.env` is git-ignored — never commit real credentials. Only `server/.env.example`
  (with placeholder values) is tracked.
- `JWT_SECRET` and `CEO_PASSWORD` should be long, random values in any real deployment — required, not
  optional, the moment this is reachable from outside your own machine (e.g. behind a tunnel).
- The contact scraper only reads a company's own public pages — it does not touch LinkedIn or any
  authenticated/private source. The discovery adapters read public listing pages only and never take
  contact details from them.
- The pipeline cannot send. It stops at `draft`, and the only transmit path
  (`POST /api/outreach/:id/send-email`) requires an approved draft and passes the daily cap first.
- Both scraper tiers refuse to scan a domain that resolves to a private/loopback/link-local address
  (`assertPublicHost` in `scraperService.js`) — the Playwright tier drives a full browser, which is a much
  bigger blast radius than a plain GET if pointed at something internal.
- `VexForge-LocalLLM`'s API has no auth — only run it on a private network, or behind a tunnel URL you
  don't share.
- Rate limiting (`express-rate-limit`) is on: a general ceiling on `/api/*` and a much tighter one on
  `/api/auth/login` specifically, since that's the credential-guessing target now that this can be
  reachable over a public tunnel.
