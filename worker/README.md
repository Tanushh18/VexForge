# VexForge Worker

The half of VexForge that has to run on your own machine.

## Why this is a separate process

Two things can't sensibly live on a cheap cloud instance:

- **Playwright/Chromium** — ~730MB resident during a run, measured. The rest of
  the server idles at ~140MB, so keeping the browser in the same process would
  force a 2GB instance for something that's otherwise comfortable on 512MB.
- **The models** — 2–16GB of RAM, and far too slow on a CPU-only box.

The second of those could have been solved with a tunnel, since Ollama is an
HTTP service. The first can't: **Playwright is an in-process library, not a
service.** There's no port to point at. Whatever drives the browser has to live
where the browser is — which is this process.

So the worker does every stage that needs a browser or a model, and the
deployed API owns everything else.

**Not every source needs the browser, though.** Only Product Hunt and the YC
directory render client-side; Hacker News launches, Reddit launches, and
funding news are all plain HTTP calls to public APIs/feeds. Selecting only
those three means the whole run skips Chromium — which is what makes a
Chromium-free environment (a GitHub Actions runner, for instance) able to run
a real discovery pass, just without Product Hunt/YC coverage. See "Running it
without a browser" below.

```
  YOUR MACHINE                          DEPLOYED
  ┌──────────────────────┐              ┌────────────────────────┐
  │ worker/              │  poll ──────►│ API                    │
  │  • Playwright        │              │  • CRM + dedupe        │
  │  • discovery         │  leads ─────►│  • approval queue      │
  │  • enrichment        │  progress ──►│  • sending (capped)    │
  │  • scoring           │              │  • reply detection     │
  │  • drafting          │              │  • follow-ups, digests │
  │ Ollama (localhost)   │              └────────────────────────┘
  └──────────────────────┘
```

The worker never writes to the database directly. It posts leads to the API,
which owns dedupe — a second implementation of that rule is exactly how the
same company ends up in the pipeline twice.

**It also can't send anything.** The worker produces drafts; the approval gate
and the daily send cap both live server-side, behind an auth it doesn't hold.

## Setup

```bash
cd worker
npm install
npx playwright install chromium     # one-time, ~95MB

cp .env.example .env                # then fill in the two required values
```

Two things must be set:

| | |
|---|---|
| `VEXFORGE_API_URL` | your deployed API (or `http://localhost:4000` while testing) |
| `WORKER_API_KEY` | must match `WORKER_API_KEY` on the server, exactly |

Generate the key once and paste the same value both places:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Until it's set on both sides the server returns **503** on every worker
endpoint — it fails closed on purpose, because an unset key must never mean
"anyone may post leads into the CRM".

You'll also want Ollama running locally with the three models pulled; see the
root README. Without it the worker still runs — discovery, enrichment and
deterministic scoring all work — you just get no drafts and no model
adjustment, and it says so at startup.

## Running it

```bash
npm start          # poll forever — what you leave running
npm run once       # take at most one job, then exit — good for cron
```

`npm start` is a poll loop: it asks the API for queued work every 15s, runs
whatever it gets, and backs off exponentially if the API is unreachable (a home
tunnel going down is normal, not exceptional). Ctrl-C finishes the job in
flight before stopping, so you don't leave a run claimed-but-abandoned; press
it twice to stop immediately.

For an unattended nightly run, `npm run once` on a schedule is usually better
than leaving the loop resident:

```cron
# 2am daily
0 2 * * * cd /path/to/VexForge/worker && /usr/bin/npm run once >> worker.log 2>&1
```

Note that a scheduled *job* still has to be queued by the server
(`PIPELINE_SCHEDULE_ENABLED=true`) — or you just click "Start run" in the
console and the worker picks it up on its next poll.

## Running it without a browser

Only Product Hunt and the YC directory need Chromium; Hacker News launches,
Reddit launches, and funding news are all plain HTTP. If the job you claim
only asks for those three, this process never calls `chromium.launch()` — the
`playwright` package imports fine with no browser binaries installed, it just
can't open one. So on a host where installing Chromium is inconvenient or
impossible (a CI runner, a very small VM), you can skip
`npx playwright install chromium` entirely and still run a real discovery pass:

```bash
npm install                          # no playwright install step
npm run once                         # as long as the queued job excludes
                                      # product_hunt and yc_directory
```

Queue a browser-free run from the console's Lead Pipeline page by leaving
those two sources unchecked, or pass `sources` explicitly when calling
`POST /api/pipeline/run`. This is what makes a scheduled GitHub Actions
workflow practical: check out the repo, `npm ci` in `worker/` (no Chromium
download), `npm run once`, free, no server to keep alive. You lose Product
Hunt/YC coverage on those runs — run the worker locally with the full
`--with-deps chromium` install occasionally to pick those back up.

## What you'll see

The console's Lead Pipeline page shows a live stage strip while a run is going
(`discover → enrich → score → draft`) plus the current company being worked on,
and a worker badge that goes offline after ~45s without a poll. That badge is
the thing to check first: a job stuck in `queued` almost always means no worker
is running, not that something broke.

## Jobs it handles

| Job | Queued by | What it does |
|---|---|---|
| `discovery` | "Start run" on the Pipeline page, or the scheduled job | Full run: crawl sources → enrich → score → draft → deliver |
| `deep_scan` | "Run deep scan" on the Admin page | One domain, browser fallback when the static pass finds nothing |

Deep scans are handed out first — they take seconds, and would otherwise sit
behind a discovery run that takes minutes.
