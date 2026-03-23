# Observability Research Tool

Automated observability tool detection for GTM teams. Upload a company list, get back which monitoring tools each company uses.

Built to eliminate hours of manual research per week across an entire GTM team.

---

## Live Demo

> **Not available publicly.** This tool runs on my startup's API keys (Azure OpenAI + SearchAPI), and every query has a real cost. I can walk through a live demo on request.

---

## Problem

In our GTM motion, we target companies based on their observability stack - specifically, whether they use Datadog, Grafana, New Relic, or similar tools.

The old process:

1. Pull a list of ICP-fit companies from Apollo
2. Manually Google each company + "Datadog" / "observability" / "monitoring"
3. Scan results, open pages, verify evidence
4. Record findings in a spreadsheet

For a list of 50 companies, this took **hours**. Multiply that by every SDR on the team, every week.

I tried solving this with [OpenClaw](https://openclaw.com) early on, but at the time it couldn't handle this kind of multi-source, evidence-based research at the quality level we needed. Results were inconsistent and required manual verification anyway - which defeated the purpose.

So I built the tool myself.

---

## Solution

Upload a CSV of companies. The tool researches each one automatically and returns a CSV with the observability tools it found, backed by source URLs.

No manual Googling. No tab switching. No copy-pasting into spreadsheets.

The entire GTM team now uses this to prep account lists in minutes instead of hours.

---

## How It Works

For each company in the uploaded CSV:

1. **Search** — Runs targeted Google queries via SearchAPI to find pages mentioning observability/monitoring tools on or about the company
2. **Analyze** — Feeds the top search results into OpenAI (GPT-5.4) with a structured prompt that acts as an "observability tool judge"
3. **Verify** — The LLM only reports tools it can back with evidence from the search results. If evidence is weak, it says so. If nothing is found, it returns "Not found" instead of guessing
4. **Process + Poll** — The backend starts a background job and returns a `jobId` immediately. The frontend polls status updates to show exactly which row is being processed and when results are ready

---

## Features

- CSV upload with background processing and polling-based progress updates
- Row-level status updates (e.g. "Processing row X") so users know the app is still running
- Adaptive polling: 1s intervals for the first 30 seconds, then 3s intervals for long-running jobs
- Evidence-based research - every result links back to a source URL
- Confidence indicators for ambiguous findings
- Retry logic with exponential backoff for API resilience
- Configurable CSV column mapping via environment variables
- Docker support for team distribution
- Dark mode UI with built-in usage guide

---

## Architecture

```
Browser (Vue.js)
  |
  | POST /research (gets jobId)
  | GET /status/:jobId (polling)
  | POST /cancel/:jobId (optional stop)
  v
Express API Server (Node.js / TypeScript)
  |
  |--- In-memory job store (pending/processing/done/error/cancelled)
  |
  |--- SearchAPI (Google search for evidence)
  |
  |--- Azure OpenAI (GPT-5.4, structured analysis)
  |
  v
CSV Response (base64-encoded, returned when job is done)
```

### Key Decisions

- **SearchAPI + LLM instead of LLM-only** — LLMs hallucinate tool usage when asked directly. By feeding real search results as context and disabling the model's own web access, the tool only reports what it can back with evidence. This was the single biggest quality improvement over my OpenClaw attempt.

- **Background jobs + polling over one long SSE stream** - For 200+ companies, runs can take around 15 minutes. Long-lived streams are fragile on strict networks/proxies and can drop mid-run. Background jobs decouple processing from the client connection, so the system is much more reliable.

- **Visible row-level progress to reduce user anxiety** - Long runs can look like a freeze if there is no feedback. Showing "Processing row X" makes it clear the app is still running and builds trust during 10-15 minute jobs.

- **Adaptive polling for UX + reliability** - The UI polls every 1 second for the first 30 seconds so users immediately see movement, then switches to every 3 seconds once they are no longer staring at the screen. This keeps the app feeling responsive without unnecessary long-run request pressure.

- **Express serving the frontend in production** - Instead of deploying frontend and backend separately, the backend serves the built Vue app as static files. One container, one URL, one deployment. Simpler for a small team.

- **Docker for team distribution** - Non-technical GTM teammates can run the tool locally with a single `docker run` command. No Node.js installation, no environment setup.

---

## Technical Highlights

- Two-stage research pipeline (search → analyze) for evidence-grounded results
- Structured LLM prompting with strict output format constraints to prevent hallucination
- Background job orchestration with in-memory job state and polling status endpoints
- Job cancellation endpoint (`POST /cancel/:jobId`) with early-exit behavior in the processor loop
- Adaptive polling strategy (fast initial updates, slower long-run cadence)
- Multi-stage Docker build for minimal production image size
- Exponential backoff retry logic for external API calls
- Configurable via environment variables (model, token limits, CSV column names)
- TypeScript end-to-end (frontend + backend)

---

## Tradeoffs

| Decision | Why | What I gave up |
|----------|-----|----------------|
| SearchAPI over direct scraping | Reliable, structured results without building a crawler | Per-query cost, rate limits |
| GPT-5.4 over o4-mini | Faster responses for this workflow, especially on long runs | Potentially higher cost depending on usage |
| Background jobs + polling over SSE | More reliable for 200+ row jobs and strict networks/proxies | Slightly more backend complexity (job state + polling endpoints) |
| Single-container deploy | Simple for a 4-person team | Can't scale frontend/backend independently |
| No database | Results are per-session CSV downloads; no persistence needed | No historical lookup or caching |
| No auth | Internal tool behind Docker; team trusts each other | Can't expose publicly without adding auth |

---

## Setup

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/observability-tool-research.git
cd observability-tool-research
npm install
npm install --prefix frontend

# Add your API keys
cp .env.example .env
# Edit .env with your keys

# Run
npm run dev
```

Or with Docker:

```bash
docker build -t observability-research .
docker run --env-file .env -p 3000:3000 observability-research
```

Open **http://localhost:3000**.

---

## Why I Built This

I'm a builder at an early-stage startup. Our GTM team was spending hours every week manually researching which companies use which observability tools - just to qualify accounts.

I tried off-the-shelf AI research tools. They weren't reliable enough for this specific task. So I built a purpose-built tool that combines targeted search with structured LLM analysis to get evidence-backed results.

It now saves the team multiple hours per week and has become part of our standard account research workflow.

The best tools come from real problems. This one came from mine.
