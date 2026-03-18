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
2. **Analyze** — Feeds the top search results into OpenAI (o4-mini) with a structured prompt that acts as an "observability tool judge"
3. **Verify** — The LLM only reports tools it can back with evidence from the search results. If evidence is weak, it says so. If nothing is found, it returns "Not found" instead of guessing
4. **Stream** — Results stream back to the UI in real time via SSE, so you see progress as each company is processed

---

## Features

- CSV upload with real-time progress streaming (SSE)
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
  | CSV upload + SSE stream
  v
Express API Server (Node.js / TypeScript)
  |
  |--- SearchAPI (Google search for evidence)
  |
  |--- Azure OpenAI (o4-mini, structured analysis)
  |
  v
CSV Response (base64-encoded, streamed back)
```

### Key Decisions

- **SearchAPI + LLM instead of LLM-only** — LLMs hallucinate tool usage when asked directly. By feeding real search results as context and disabling the model's own web access, the tool only reports what it can back with evidence. This was the single biggest quality improvement over my OpenClaw attempt.

- **SSE streaming over polling** - Processing 50 companies takes minutes. SSE lets the frontend show which company is being processed in real time, so users know the tool is working and can estimate remaining time.

- **Express serving the frontend in production** - Instead of deploying frontend and backend separately, the backend serves the built Vue app as static files. One container, one URL, one deployment. Simpler for a small team.

- **Docker for team distribution** - Non-technical GTM teammates can run the tool locally with a single `docker run` command. No Node.js installation, no environment setup.

---

## Technical Highlights

- Two-stage research pipeline (search → analyze) for evidence-grounded results
- Structured LLM prompting with strict output format constraints to prevent hallucination
- Server-Sent Events with 2KB padding to force HTTP flush on each progress update
- Multi-stage Docker build for minimal production image size
- Exponential backoff retry logic for external API calls
- Configurable via environment variables (model, token limits, CSV column names)
- TypeScript end-to-end (frontend + backend)

---

## Tradeoffs

| Decision | Why | What I gave up |
|----------|-----|----------------|
| SearchAPI over direct scraping | Reliable, structured results without building a crawler | Per-query cost, rate limits |
| o4-mini over GPT-4o | Cheaper per-token for a structured classification task | Slightly less reasoning depth |
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
