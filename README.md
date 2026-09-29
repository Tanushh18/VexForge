# VexForge HQ

An internal "AI company" console for VexForge, running entirely on local and hosted models: an end-to-end lead-generation pipeline (discover → enrich → score → draft), a live org chart across Operations, HR, Tech, Finance and Support, a CRM/outreach queue with a human-approval gate and a daily send cap, a call/feedback ticket system, a full activity log, and a voice-enabled chatbot (Ember, the Head Manager) you command in plain English. Includes the public marketing site with a working contact form wired into the CRM.

---

## Table of Contents

- [Description](#description)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Dependencies](#dependencies)
- [Contribution Guide](#contribution-guide)

---

## Description

VexForge HQ is a comprehensive lead-generation and sales management system designed for AI-driven prospecting. It automates the entire outreach lifecycle: discovering potential customers from 20 different sources, enriching their contact information, scoring leads based on multiple signals, drafting personalized outreach, managing approvals, and tracking responses.

### Key Highlights

- **Two-Process Architecture**: Separated worker (local discovery with Playwright) and server (deployed API with CRM) to optimize memory usage
- **AI-Powered Pipeline**: Uses Groq API for intelligent lead scoring, drafting, and chat interactions
- **Real-Time Updates**: Live job progress reporting from worker to UI
- **Multi-Source Discovery**: Crawls 20 different platforms including Hacker News, Reddit, Product Hunt, Y Combinator, and more
- **Smart Contact Enrichment**: Combines static site scanning with headless browser fallback
- **Deterministic Scoring**: Signal-based lead qualification with configurable weights
- **Approval Gate**: All messages pass through human review before sending
- **Daily Send Cap**: Prevents spam classification through rate limiting
- **Activity Logging**: Full audit trail of all actions
- **Voice Chatbot**: Ember, the Head Manager, for voice-enabled command interface
- **Public Marketing Site**: Includes working contact form integrated with CRM

---

## Tech Stack

### Backend
- **Runtime**: Node.js 22 (LTS)
- **Framework**: Express.js 4.21.2
- **Database**: MongoDB (via Mongoose 8.9.5)
- **API Keys**: Groq (hosted LLM)
- **Email**: Nodemailer 9.0.5 (SMTP-based outreach)
- **Reply Detection**: IMAP (imapflow 1.0.171) + mailparser 3.7.2
- **HTTP Client**: Axios 1.7.9
- **Authentication**: JWT (jsonwebtoken 9.0.2), bcryptjs
- **HTML Parsing**: Cheerio 1.0.0
- **CORS**: cors 2.8.5
- **Logging**: Morgan 1.10.0
- **Rate Limiting**: express-rate-limit 7.4.1
- **Environment**: dotenv 16.4.7

### Frontend
- **UI Framework**: React 18.3.1
- **Build Tool**: Vite 6.0.7
- **Routing**: React Router DOM 7.18.2
- **Dev Server**: Vite dev server (port 5173)

### Worker (Local)
- **Browser Automation**: Playwright 1.48.2 (Chromium headless)
- **HTTP Client**: Axios 1.7.9
- **HTML Parsing**: Cheerio 1.0.0
- **Environment**: dotenv 16.4.7

### Shared Code
- **Model Routing**: Multi-model support with fallback (shared/modelRouter.js)
- **Scoring Engine**: Deterministic signal-based scoring (shared/scoring.js)
- **Outreach Prompts**: LLM-driven message generation (shared/outreach.js)

### Deployment
- **Platform**: Render (render.yaml blueprint)
- **Container**: Docker (Node.js 22-bookworm-slim)
- **Database Hosting**: MongoDB Atlas (free tier compatible)

### Optional Services
- **Transcription**: OpenAI Whisper-compatible endpoint
- **Notifications**: Telegram Bot API
- **CI/CD**: GitHub Actions (pipeline.yml, diagnose-sources.yml)

---

## Features

### Lead Generation Pipeline

#### 1. **Multi-Source Discovery (20 Platforms)**

**Direct HTTP/API Sources (3)**:
- Hacker News launches (via Algolia API)
- Reddit launches (r/startups, r/SaaS)
- Funding news (Google News RSS)

**Playwright Browser Sources (17)**:
- Product Hunt
- Y Combinator directory
- Directory/Launch Boards: BetaList, BetaPage, Indie Hackers, SaaSHub, F6S, StartupRanking, Launching Next, DevHunt, Peerlist, Wellfound, LibHunt, OpenAlternatives, AlternativeTo, Uneed, Microlaunch

**Key Features**:
- Generic harvester for 15 directory sites (reduces maintenance)
- Rotation-based crawling (8 sources per run by default)
- Graceful failure isolation (one source's failure doesn't break the run)
- Configurable per-source limits (`PIPELINE_PER_SOURCE`)

#### 2. **Contact Enrichment**
- Static site scanning for emails
- Headless browser fallback for client-rendered sites
- Mandatory contact requirement (leads without email are dropped)
- Domain-based verification

#### 3. **Lead Scoring**
- **Deterministic signals** with configured weights
- **AI adjustment**: ±15 adjustment from reasoning model
- **Base score**: 30 points
- **Configurable thresholds**: Draft minimum score, daily send cap
- **Signal examples**: Funding status, headcount, integration signals, etc.

#### 4. **Message Drafting**
- AI-powered outreach copy generation
- Uses Groq API for fluent, personalized messages
- Runs on worker (local Ollama or deployed Groq)
- Can be skipped if API is unavailable

#### 5. **Lead Delivery & Deduplication**
- API-side deduplication against existing CRM
- Prevents duplicate records across runs
- RESTful API integration (POST /api/leads)

### CRM & Outreach Management

#### Lead Management
- Lead storage and search
- Contact information tracking
- Company details (website, funding, headcount, etc.)
- Lead status tracking (new, enriched, scored, drafted, approved, sent, responded)
- Search and filtering capabilities

#### Outreach Queue
- Approval gate for all outreach messages
- Human review before sending
- Daily send cap (default: 25 emails/day)
- Automatic deduplication against existing messages
- Message template tracking

#### Response Detection
- IMAP-based inbox polling (automatic or manual)
- Reply detection from known leads
- Auto-flip to "responded" status
- Support for multiple SMTP/IMAP accounts

#### Follow-Up Management
- Automatic follow-up draft queuing after `FOLLOWUP_AFTER_DAYS`
- Re-engagement tracking
- Lead lifecycle management

### Organization & Team Management

#### Live Org Chart
- Real-time view across departments: Operations, HR, Tech, Finance, Support
- Employee management (CRUD operations)
- Department assignments
- Role tracking

#### Activity Log
- Complete audit trail of all system actions
- User activity tracking
- Pipeline run history
- Email sending logs
- Lead updates

### Communication & Support

#### Ticket System
- Call/feedback ticket management
- Ticket categorization and assignment
- Status tracking (open, in-progress, resolved)
- Integration with activity log

#### Voice Chatbot (Ember)
- Voice-enabled command interface
- Plain English commands
- Real-time chat responses
- Integration with lead data and CRM

#### Email Integration
- Telegram push notifications (new drafts, tickets, replies, digests)
- Email-based reply detection
- Automatic follow-up nudges

### Daily Digests
- Automated summary reports
- Pipeline run summaries
- Response summaries
- Scheduled or manual generation

### Public Marketing Site
- Working contact form
- CRM integration (form submissions → lead database)
- Static hosting on Render
- Proxy /api/* routes to backend API

---

## Project Structure

```
VexForge/
├── server/                      # Node.js/Express API (deployed to Render)
│   ├── src/
│   │   ├── index.js             # Express app setup, routes mounting
│   │   ├── config/              # Configuration modules
│   │   ├── middleware/          # Auth, error handling, logging
│   │   ├── models/              # MongoDB schemas (Mongoose)
│   │   │   ├── ActivityLog.js
│   │   │   ├── ChatMessage.js
│   │   │   ├── Employee.js
│   │   │   ├── Lead.js
│   │   │   ├── OutreachMessage.js
│   │   │   ├── PipelineRun.js
│   │   │   ├── Ticket.js
│   │   │   └── ...
│   │   ├── routes/              # API endpoints
│   │   │   ├── auth.js          # Authentication
│   │   │   ├── leads.js         # Lead CRUD & search
│   │   │   ├── outreach.js      # Outreach queue management
│   │   │   ├── pipeline.js      # Pipeline job management
│   │   │   ├── company.js       # Company management
│   │   │   ├── employees.js     # Employee management
│   │   │   ├── tickets.js       # Ticket system
│   │   │   ├── chat.js          # Chat/chatbot
│   │   │   ├── digest.js        # Daily digests
│   │   │   ├── activity.js      # Activity log
│   │   │   ├── admin.js         # Admin settings
│   │   │   └── public.js        # Public endpoints (contact form)
│   │   └── services/            # Business logic
│   │       ├── seed.js          # Database seeding
│   │       └── ...
│   ├── test/                    # Test files
│   ├── Dockerfile               # Docker container spec
│   ├── package.json
│   └── .env.example
│
├── client/                      # React + Vite frontend (Render static site)
│   ├── src/
│   │   ├── main.jsx             # React entry point
│   │   ├── App.jsx              # Root component
│   │   ├── AuthContext.jsx      # Auth state management
│   │   ├── pages/               # Page components
│   │   ├── components/          # Reusable UI components
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API client services
│   │   ├── office/              # Office/org chart component
│   │   └── styles.css           # Global styles
│   ├── vite.config.js
│   ├── index.html
│   └── package.json
│
├── worker/                      # Local worker (runs on your machine or GitHub Actions)
│   ├── src/
│   │   ├── index.js             # Main worker loop (polling, job processing)
│   │   ├── diagnose.js          # Source diagnostics utility
│   │   ├── setup.js             # Initial setup
│   │   ├── pipeline.js          # Pipeline orchestration (discover → enrich → score → draft)
│   │   ├── leadSources/         # Discovery source implementations
│   │   │   ├── genericDirectory.js   # Generic extractor for 15 directory sites
│   │   │   ├── directorySites.js     # Directory site configurations
│   │   │   └── ...
│   │   └── services/            # Discovery, enrichment, scoring modules
│   ├── test/                    # Test files
│   ├── README.md                # Detailed worker documentation
│   ├── package.json
│   └── .env.example
│
├── shared/                      # Shared code (imported by both server & worker)
│   ├── modelRouter.js           # Multi-model support with fallback logic
│   ├── scoring.js               # Signal-based scoring engine
│   ├── outreach.js              # Outreach message prompts
│   └── package.json
│
├── website/                     # Public marketing site (Render static)
│   ├── index.html               # Public landing page
│   ├── contact-form.html        # Contact form (integrated with CRM)
│   ├── config.js                # Site configuration
│   └── ...
│
├── .github/
│   └── workflows/
│       ├── pipeline.yml         # GitHub Actions: runs worker on schedule or trigger
│       └── diagnose-sources.yml # Tests all discovery sources
│
├── render.yaml                  # Render deployment blueprint (3 services)
├── package.json                 # Root package (dev scripts)
├── .gitignore                   # Git ignore rules
└── README.md                    # Main documentation (this file)
```

---

## Installation

### Prerequisites

- **Node.js 22+** (LTS recommended)
- **npm 10+**
- **MongoDB Atlas** account (free tier) or local MongoDB running on `localhost:27017`
- **Git**
- **Playwright binary** (auto-installed via npm)

### Local Development Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/Tanushh18/VexForge.git
cd VexForge
```

#### 2. Install Dependencies

```bash
# Install all workspace dependencies (server, client, worker)
npm run install:all
```

This command installs dependencies for:
- `server/` - Node.js API
- `client/` - React frontend
- `worker/` - Local lead discovery worker

#### 3. Configure Environment Variables

**Server Setup** (`.env` in server directory):

```bash
cd server
cp .env.example .env
```

Edit `server/.env` with your settings:
- `MONGO_URI` - MongoDB connection string (MongoDB Atlas or local)
- `JWT_SECRET` - Random 32+ character string for JWT signing
- `CEO_EMAIL` / `CEO_PASSWORD` / `CEO_NAME` - Your admin login
- `GROQ_API_KEYS` - Comma-separated Groq API keys (from console.groq.com/keys)
- `SMTP_*` - Gmail SMTP credentials (for outreach)
- `IMAP_*` - Gmail IMAP credentials (for reply detection, optional)
- `WORKER_API_KEY` - Shared secret with worker (generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `TELEGRAM_*` - Optional Telegram notifications
- `CLIENT_ORIGIN` - CORS allowed origins (default: `http://localhost:5173`)

**Worker Setup** (`.env` in worker directory):

```bash
cd ../worker
cp .env.example .env
```

Edit `worker/.env` with your settings:
- `VEXFORGE_API_URL` - Server URL (local: `http://localhost:4000`)
- `WORKER_API_KEY` - Must match server's `WORKER_API_KEY`
- `GROQ_API_KEYS` - Comma-separated Groq API keys (same as server)
- `WORKER_ID` - Name for this worker (e.g., "desktop", "ci-runner")

#### 4. Initialize the Database

```bash
cd server
npm run seed
```

This seeding script initializes:
- CEO admin account
- Empty lead database
- Default settings and configuration
- Sample departments and employees (optional)

#### 5. Start Development Server

In one terminal (API):
```bash
cd server
npm run dev
```

In another terminal (React frontend):
```bash
cd client
npm run dev
```

The API runs on `http://localhost:4000` and the frontend on `http://localhost:5173`.

#### 6. Start the Local Worker (Optional)

In a third terminal, run the lead discovery worker:
```bash
cd worker
npm start
```

The worker will poll the API every 15 seconds (configurable via `WORKER_POLL_MS`) for jobs.

### MongoDB Setup

#### Option A: MongoDB Atlas (Recommended for Render)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free tier cluster in a region close to your deployment
3. Allowlist Render's outbound IPs or use `0.0.0.0/0` (username/password-based)
4. Generate a connection string: `mongodb+srv://user:password@cluster.mongodb.net/vexforge_hq`
5. Copy this to `server/.env` as `MONGO_URI`

#### Option B: Local MongoDB

```bash
# macOS (via Homebrew)
brew services start mongodb-community

# Linux (Ubuntu/Debian)
sudo systemctl start mongod

# Or Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

Then use `mongodb://127.0.0.1:27017/vexforge_hq` as your `MONGO_URI`.

### Groq API Keys

1. Sign up at [console.groq.com](https://console.groq.com)
2. Navigate to **Keys** and create a free-tier API key
3. Verify available models under **Settings → Limits**
4. Add to `server/.env` and `worker/.env` as `GROQ_API_KEYS` (comma-separated for fallback)

---

## Usage

### Web Dashboard

#### Login

1. Navigate to `http://localhost:5173` (or deployed URL)
2. Log in with your CEO credentials (from `.env`)
3. First login shows onboarding

#### Lead Pipeline Page

1. Click **Lead Pipeline** in sidebar
2. Click **Start run** to queue a job
3. Monitor live progress (discover → enrich → score → draft)
4. View discovered leads and their scores
5. Auto-drafted messages appear in the **Outreach Queue**

**Choosing specific sources**: Check boxes for exact sources to run; otherwise, the next 8 sources in rotation are used.

#### Outreach Queue

1. Click **Outreach** in sidebar
2. Review drafted messages
3. Click **Approve** to move to approval queue
4. Click **Send** to deliver via SMTP (counts against `DAILY_SEND_CAP`)
5. Track delivery status and replies

#### CRM / Leads

1. Click **Leads** or **Companies** in sidebar
2. Search by company name, website, or email
3. View full lead details (contact, company, score, outreach history)
4. Edit leads manually or mark as "Do Not Email"

#### Org Chart

1. Click **Office** in sidebar
2. View live organization chart (Operations, HR, Tech, Finance, Support)
3. Add/edit employees and their roles

#### Tickets

1. Click **Support** in sidebar
2. Create or view support tickets
3. Track call feedback and follow-ups

#### Chat (Ember)

1. Click **Chat** in sidebar
2. Ask Ember (Head Manager) questions in plain English
3. Ember pulls from lead data, activity logs, and company state
4. (Optional) Use voice input for hands-free commands

#### Activity Log

1. Click **Settings → System → Activity Log**
2. View complete audit trail (who, what, when)

#### Daily Digest

1. Manual: Click **Settings → Digest → Generate Now**
2. Auto: Scheduled daily (configurable in code)
3. Includes pipeline summary, responses, activity highlights

### Local Worker

#### Manual Run

```bash
cd worker
npm start
```

Worker polls the server every `WORKER_POLL_MS` (default 15s) and:
1. Claims a pending job
2. Runs discovery (20 sources or rotation subset)
3. Enriches contacts
4. Scores leads
5. Drafts outreach
6. Posts results to `/api/pipeline/deliver`
7. Reports progress every 5-10 seconds

#### One-Time Run (Local)

```bash
npm run once
```

Runs a single pipeline execution and exits.

#### Source Diagnostics

```bash
npm run diagnose
```

Tests all 20 discovery sources without posting to API (debugging & validation).

### GitHub Actions Workflow

#### Automated Scheduled Runs

1. Push `worker/.env` secrets to GitHub:
   - `VEXFORGE_API_URL` (your deployed API URL)
   - `WORKER_API_KEY` (must match server)
   - `GROQ_API_KEYS` (Groq API keys)

2. `.github/workflows/pipeline.yml` runs on daily cron (default 8 AM UTC) or manual trigger
3. Actions runner claims a job, runs the pipeline, delivers leads
4. Console shows **"Worker: GitHub Actions"** when online

#### Source Diagnostics Workflow

`.github/workflows/diagnose-sources.yml` tests all 20 sources with no secrets (safe to run anytime).

---

## Configuration

### Server Environment Variables

See `server/.env.example` for full reference. Key settings:

#### Core
- `PORT` - API port (default 4000)
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - Session signing secret
- `CLIENT_ORIGIN` - CORS allowed origins

#### Admin
- `CEO_EMAIL` / `CEO_PASSWORD` / `CEO_NAME` - Initial admin account

#### Models
- `GROQ_API_KEYS` - Hosted LLM API keys (comma-separated)
- `GROQ_MODEL_REASONING` - Lead scoring, fit assessment (default: openai/gpt-oss-120b)
- `GROQ_MODEL_DRAFTING` - Outreach copy generation (default: openai/gpt-oss-20b)
- `GROQ_MODEL_FAST` - Classification, summaries (default: openai/gpt-oss-20b)

#### Email Outreach
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` - Gmail SMTP
- `SMTP_FROM_NAME` / `SMTP_FROM_EMAIL` - Sender identity

#### Reply Detection
- `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASS` - Gmail IMAP (optional)
- Defaults to SMTP credentials if unset

#### Notifications
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` - Telegram push notifications

#### Lead Pipeline
- `DAILY_SEND_CAP` - Max emails per day (default 25)
- `PIPELINE_PER_SOURCE` - Leads per source (default 12)
- `PIPELINE_ROTATION_BATCH_SIZE` - Sources per rotation run (default 8)
- `PIPELINE_AUTO_DRAFT_TOP` - Auto-draft top N leads (default 5)
- `PIPELINE_MIN_DRAFT_SCORE` - Minimum score to draft (default 60)
- `PIPELINE_SCHEDULE_ENABLED` - Auto-run on schedule (default false)
- `PIPELINE_EVERY_HOURS` - Schedule interval (default 24)

#### Worker
- `WORKER_API_KEY` - Shared secret with worker
- `WORKER_STALE_AFTER_MS` - Time before marking worker offline (default 45s)

#### GitHub Actions Integration
- `GITHUB_TRIGGER_TOKEN` - Fine-grained PAT for GitHub Actions (optional)
- `GITHUB_TRIGGER_OWNER` / `GITHUB_TRIGGER_REPO` - GitHub repo coordinates
- `GITHUB_TRIGGER_WORKFLOW` - Workflow file name (default pipeline.yml)

### Worker Environment Variables

See `worker/.env.example` for full reference:

- `VEXFORGE_API_URL` - API endpoint (local: `http://localhost:4000`)
- `WORKER_API_KEY` - Shared secret (must match server)
- `WORKER_ID` - Display name in console
- `WORKER_POLL_MS` - Job poll interval (default 15000ms)
- `GROQ_API_KEYS` - Hosted LLM API keys

### Shared Configuration

`shared/scoring.js` defines:
- Signal weights for lead scoring
- Base score (30)
- Signal definitions (funding, headcount, integration, etc.)

Edit this file to adjust scoring logic. See scoring comments for weights and reasoning.

---

## Dependencies

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **Server** | | |
| express | ^4.21.2 | HTTP API framework |
| mongoose | ^8.9.5 | MongoDB ODM |
| axios | ^1.7.9 | HTTP client |
| jsonwebtoken | ^9.0.2 | JWT authentication |
| bcryptjs | ^2.4.3 | Password hashing |
| nodemailer | ^9.0.5 | SMTP email sending |
| imapflow | ^1.0.171 | IMAP reply detection |
| mailparser | ^3.7.2 | Email parsing |
| cheerio | ^1.0.0 | HTML parsing |
| dotenv | ^16.4.7 | Environment loading |
| cors | ^2.8.5 | CORS middleware |
| morgan | ^1.10.0 | Request logging |
| express-rate-limit | ^7.4.1 | Rate limiting |
| **Client** | | |
| react | ^18.3.1 | UI framework |
| react-router-dom | ^7.18.2 | Routing |
| vite | ^6.0.7 | Build tool & dev server |
| **Worker** | | |
| playwright | ^1.48.2 | Browser automation |
| cheerio | ^1.0.0 | HTML parsing |
| axios | ^1.7.9 | HTTP client |
| dotenv | ^16.4.7 | Environment loading |

### Optional Dependencies

- `openai` (Whisper API) - Transcription
- `node-telegram-bot-api` - Telegram notifications

---

## Contribution Guide

### Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Follow the setup instructions under [Installation](#installation)

### Development Workflow

1. **Make changes** in your branch
2. **Test locally**:
   ```bash
   npm test                           # Run all tests
   npm test --prefix server          # Server tests only
   npm test --prefix worker          # Worker tests only
   ```
3. **Commit** with descriptive messages:
   ```bash
   git commit -m "feat: add new scoring signal"
   git commit -m "fix: resolve reply detection race condition"
   git commit -m "docs: update README with Render deployment steps"
   ```
4. **Push** to your fork
5. **Open a Pull Request** against `main` with:
   - Clear description of changes
   - Reference to related issues
   - Test results (automated checks + manual testing)

### Code Standards

#### JavaScript/Node.js
- Use ES6+ syntax (const, arrow functions, template literals)
- Async/await for asynchronous operations
- Meaningful variable/function names
- Comments for complex logic
- No console.log in production (use logging middleware)

#### React
- Functional components with hooks
- Props validation (optional but recommended)
- Meaningful component names
- Separate concerns (components, hooks, services)

#### Git Commits
- Use conventional commit format: `type(scope): message`
  - `feat:` new feature
  - `fix:` bug fix
  - `docs:` documentation changes
  - `refactor:` code restructuring
  - `test:` test additions/updates
  - `chore:` dependency or config updates

### Architecture Guidelines

#### Two-Process Design

- **Worker** (local/GitHub Actions): Handles Playwright discovery, enrichment, scoring, drafting
- **Server** (deployed): Handles CRM, approvals, sending, replies, chat
- **Shared** (server + worker): Model routing, scoring engine, outreach prompts

Rationale: Playwright/Chromium requires ~730MB; keeping it off the deployed server keeps costs low.

#### Adding a Discovery Source

1. Create new file in `worker/src/leadSources/`
2. Export async function returning `[{name, website, timing_signals?}]`
3. Add entry to `worker/src/leadSources/directorySites.js` or implement custom harvester
4. Wrap with `safeSource()` to isolate failures
5. Test with `npm run diagnose`

#### Modifying Scoring

1. Edit `shared/scoring.js`
2. Add/modify signal definitions and weights
3. Update comments explaining the signal
4. Test on sample leads
5. Document weight changes in commit message

#### Adding a CRM Feature

1. Create MongoDB model in `server/src/models/`
2. Create route handler in `server/src/routes/`
3. Add React component in `client/src/pages/` or `components/`
4. Hook up API calls in `client/src/services/`
5. Test full flow (create, read, update, delete)

### Testing

#### Server Tests
```bash
cd server
npm test                        # Run all tests
node --test test/specific.test.js   # Run specific test
```

#### Worker Tests
```bash
cd worker
npm test
```

#### Manual Testing Checklist

- [ ] Local dev setup runs without errors
- [ ] Can log in with CEO credentials
- [ ] Can start a manual pipeline run
- [ ] Worker picks up job and reports progress
- [ ] Leads appear in CRM after run completes
- [ ] Can approve and send an outreach message
- [ ] Reply detection works (if IMAP configured)
- [ ] Org chart loads and displays correctly
- [ ] Chat/Ember responds to queries
- [ ] Activity log records all actions

### Reporting Issues

When opening an issue, include:
- **Description**: What is the problem?
- **Steps to reproduce**: How to trigger the issue?
- **Expected behavior**: What should happen?
- **Actual behavior**: What happened instead?
- **Environment**: Node version, OS, MongoDB setup, etc.
- **Logs**: Any error messages or stack traces

### Documentation

- Update README.md when adding features or changing setup steps
- Document new environment variables in `.env.example`
- Add JSDoc comments to exported functions
- Update this guide for new architectural decisions

### Deployment

Deployment to Render is configured via `render.yaml`:

1. **API (vexforge-api)**: Docker container with Node.js + Express
2. **Console (vexforge-console)**: Static React build
3. **Website (vexforge-site)**: Static marketing site

To deploy:
1. Push to `main` branch (configure auto-deploy in Render dashboard)
2. Or manually trigger: `git push render main`
3. Monitor builds in Render dashboard

See `render.yaml` comments for configuration details.

---

## Quick Reference

### Common Commands

```bash
# Development
npm run dev                     # Start server + client
npm run worker                  # Start worker
npm run install:all            # Install all dependencies

# Testing
npm test                        # Run all tests
npm test --prefix server       # Server tests
npm test --prefix worker       # Worker tests

# Database
cd server && npm run seed      # Initialize database

# Deployment
git push render main            # Push to Render (if configured)
```

### Key Files

- **Server entry**: `server/src/index.js`
- **Routes**: `server/src/routes/*.js`
- **Models**: `server/src/models/*.js`
- **Scoring logic**: `shared/scoring.js`
- **Model routing**: `shared/modelRouter.js`
- **Worker loop**: `worker/src/index.js`
- **Client entry**: `client/src/main.jsx`
- **Styles**: `client/src/styles.css`

### Support

- **Issues**: GitHub Issues (include logs, reproduction steps)
- **Discussions**: GitHub Discussions for questions
- **Docs**: See `worker/README.md` for worker-specific docs

---

## License

See LICENSE file (if present) or contact the repository owner.

---

**Last Updated**: September 2026
**Maintainer**: Tanushh18
