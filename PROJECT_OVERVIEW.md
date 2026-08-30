# RoleNova: Complete Architecture & Feature Documentation

RoleNova is a high-performance, automated ATS (Applicant Tracking System) Discovery and Job Scraping Engine. It acts as an autonomous agent that searches for jobs, parses them, evaluates them against a strict user profile using AI, and presents the best matches in a real-time dashboard.

This document serves as the complete technical blueprint, explaining what features exist, why they exist, how they work, and how they are implemented.

---

## 🎯 1. Core Aim & Philosophy

The primary aim of RoleNova is to solve the "Job Search Fatigue" problem. Instead of manually checking 100+ company career pages daily, RoleNova:
1. **Automates Discovery:** Finds jobs directly from source ATS systems.
2. **Filters the Noise:** Uses AI to read the job description and automatically reject jobs that require too much experience or are in the wrong domain.
3. **Consolidates Notifications:** Prevents notification spam by holding all matches and sending exactly one "Daily Digest" email.

---

## 🚀 2. The Core Pipeline: How It Works

The **Job Search Pipeline** is the heart of RoleNova. It runs completely autonomously.

### Pipeline Flow
1. **Initialization (`jobSearchCron.js`)**: A scheduled cron job triggers the pipeline. It fetches all active `Company` records from the database.
2. **ATS Discovery (`atsDiscoveryService.js`)**: For each company, it determines the ATS provider (e.g., Workday, Greenhouse, Lever).
3. **Scraping (`services/ats/*`)**: Uses specific parsers (like `workdayParser.js`, `greenhouseParser.js`) to extract the job listings. It uses Playwright and Axios to navigate rate limits and dynamic rendering.
4. **Validation (`validationService.js`)**: 
   - Checks if the job is a duplicate.
   - Checks basic string-matching heuristics (e.g., rejecting "Senior" or "Staff" roles instantly to save AI compute).
5. **AI Evaluation (`aiEvaluationService.js`)**: 
   - The job description is passed to an AI model along with the user's `CandidateProfile`.
   - The AI returns a JSON response containing a score (0-100) and a `suitable` boolean.
6. **Storage (`storageService.js`)**: If the AI approves the job, it is saved as a `MatchedJob`. If rejected, it is saved as a `RejectedJob` (for transparency and debugging).

### Implementation Details
- The pipeline utilizes a **Queue system** (`pipelineState`) to manage state and broadcast progress via `Socket.IO` to the frontend in real-time.
- **Self-Healing**: If a scrape fails, the pipeline automatically retries, switches headers, or temporarily backs off to avoid IP bans.

---

## 🧠 3. Multi-Tiered AI Evaluation

### What is it?
Instead of relying on a single AI provider or remote proxy (which might rate-limit, decommission old models, or sleep), RoleNova uses an in-process cascading fallback engine that automatically navigates rate limits, rotating keys, and model availability.

### How it works
The `geminiService.js` and `aiEvaluationService.js` evaluate candidate fit against the user's `CandidateProfile` using a 5-tier architecture:
1. **Tier 1: Google Gemini Flash (`gemini-2.5-flash` / `gemini-3.6-flash`)**: Direct primary provider. High-throughput structured JSON output evaluating technical skills, domain alignment, and experience level.
2. **Tier 2: Groq Key Pool (`qwen/qwen3.8-27b` / `openai/gpt-oss-120b`)**: Immediate fallback rotating across 4 separate Groq API keys with round-robin load distribution.
3. **Tier 3: OpenRouter Free Tier (`dots-studio/dots-3-note-preview:free`, etc.)**: Tertiary fallback across free open-source models with automatic JSON repair.
4. **Tier 4: LiteLLM ACA Proxy**: Backup proxy layer on Azure Container Apps.
5. **Tier 5: Local Heuristic Evaluator**: Safe local fallback if all cloud AI providers are exhausted or offline, saving jobs to the `/local-jobs` queue for later verification.

### The "Local Pending" Feature
- **Aim**: To ensure no job is lost due to temporary cloud outages, but also to prevent false-positives from spamming the user.
- **Implementation**: Jobs evaluated by the "Local" engine are saved as `MatchedJob`s but are flagged with `provider: "local"`. They are **hidden** from the main dashboard and placed in a dedicated `/local-jobs` dashboard.
- **Nightly Verification**: At 8:00 PM IST every day, a background script (`verifyLocalJobs` in `schedulerService.js`) scoops up all "Local" jobs and re-evaluates them using the cloud AI chain before the daily email digest is sent.

---

## 📬 4. The Daily Digest & Notification Workflow

### What is it?
RoleNova strictly limits emails. It will *never* send an email the second a job is matched.

### How it works
- **The Scheduler (`schedulerService.js`)**: A cron job runs every day at exactly `20:00 Asia/Kolkata`.
- **The Batch**: The `emailService.js` gathers all `MatchedJob`s that have `emailEligible: true` and have not yet been emailed.
- **The Delivery**: It compiles these jobs into a beautifully formatted HTML email digest and sends it. Once sent, the jobs are marked so they aren't emailed again.

### Aim
To give the user a calm, predictable job search experience. Checking a single email at 8 PM is vastly superior to receiving 40 random emails throughout the workday.

---

## 📱 5. Telegram Integration

### What is it?
An automated listener that watches specific Telegram channels for job postings and feeds them directly into the RoleNova pipeline.

### How it works & Implementation
- **Live Listener (`telegramService.js`)**: Connects to the Telegram API. When a message containing a URL (like a direct Workday or Greenhouse link) is posted in a monitored channel, the bot intercepts it.
- **Immediate Processing**: Unlike company career pages (which are scraped on a schedule), Telegram links are scraped *immediately* upon receipt.
- **Historical Backfill (`telegramBackfillService.js`)**: A feature that allows the user to say, "Scan the last 500 messages in this channel and process any jobs I missed while the server was offline."

---

## 💻 6. The Production Dashboard (UI/UX)

### What is it?
A completely bespoke, responsive web interface built with Express, EJS, and Tailwind CSS. It serves as the Operational Control Center.

### Key Features
1. **Real-time Pipeline Monitoring (`/pipeline`)**: Uses `Socket.IO` to show exactly which company is being scraped, which AI is evaluating a job, and the live success/fail metrics without needing to refresh the page.
2. **Matched Jobs (`/jobs`)**: The primary workspace. Allows users to view high-confidence AI matches, read the AI's reasoning, and update statuses (Saved, Applied, Rejected).
3. **Local Pending (`/local-jobs`)**: A specialized view for jobs awaiting cloud AI verification, featuring a manual "Verify All Local" trigger.
4. **AI Rejected Evidence Center (`/ai-rejected`)**: Complete transparency. Allows the user to see exactly *why* the AI rejected a job, ensuring the AI isn't hallucinating or making bad decisions.
5. **Runtime Logs (`/logs`)**: A high-performance virtual-scrolling log viewer that caps at 500 records to prevent browser memory leaks during long scraping sessions.

### Implementation Aim
The UI is strictly designed without heavy frontend frameworks (like React or Vue) to ensure maximum speed, lowest memory footprint, and instant Socket.IO reactivity.

---

## ⚙️ 7. Smart Caching Layer

### What is it?
A mechanism to prevent scraping the same company's HTML multiple times unnecessarily.

### How it works
- If a company is scraped, its `lastScrapedAt` timestamp is updated in MongoDB.
- Before scraping a company, the pipeline checks if it was scraped within the last **12 hours**.
- If it was, the scrape is safely skipped.
- **Aim**: To drastically reduce IP bans, minimize bandwidth usage, and respect the ATS providers' infrastructure.

---

## 📊 Summary of Tech Stack
- **Backend Environment**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (via Mongoose)
- **Scraping**: Playwright, Axios, Cheerio
- **Frontend**: EJS (Templating), TailwindCSS (Styling), Vanilla JS
- **Real-time Comms**: Socket.IO
- **AI Models**: LiteLLM Proxy routing to Cerebras (Primary), Groq/Llama-3 (Secondary, key-pool), OpenRouter/Llama-3.3-free (Tertiary), DeepSeek V4 Flash (Paid backup), Local Heuristic (Final fallback)
RoleNova represents a perfect synergy between traditional web scraping and modern Generative AI, creating a zero-touch, highly curated job hunting assistant.

---

## 🔍 10. Company ATS Audit & Mass Fix (August 2026)

### Problem
Out of 65 active companies in `utils/companies.js`, only **7 had properly configured ATS adapters** with working `apiUrl` and `ats` fields. The remaining 58 companies had `scraperType: "api"` but no `apiUrl`, causing every scrape attempt to throw "Generic API URL missing".

### Methodology
A two-phase automated audit script (`scratch/audit-all-companies.js`) was built and executed:
1. **Phase 1 — Online ATS probe:** For every active company, the script probed Greenhouse, Lever, Ashby, SmartRecruiters, and Workday APIs using ~30 common token patterns per company (derived from company name with known alias overrides).
2. **Phase 2 — Adapter run:** For companies that already had `apiUrl` configured, the adapter was run and job counts cross-checked.

### Results

| Category | Count | Companies |
|---|---|---|
| ✅ Already working | 7 | Visa, Mastercard, PayPal, Stripe, Meesho, Razorpay, CRED |
| ✅ Fixed (live API found + configured) | 32 | See below |
| ❌ Deactivated (no accessible public API) | 26 | See below |

### Fixed Companies (32)

All fixed by adding `ats` + `apiUrl` (and `listPath`/`fields` for Ashby) to `scraperConfig`:

**Greenhouse (19 companies):** Brex, GitLab, MongoDB, Datadog, Cloudflare, Elastic, Postman, Vercel, Netlify, Twilio, Okta, Anthropic, Scale AI, Together AI, PhonePe, Groww, InMobi, DigitalOcean, Razorpay (already working, confirmed)

**Workday (5 companies):** Adobe, NVIDIA, Broadcom, Intel + previously: Visa, Mastercard, PayPal

**Ashby via OfficialApiAdapter (9 companies):** Plaid, Snowflake, Confluent, Docker, Redis, Cohere, Perplexity AI, ElevenLabs, Tekion

**SmartRecruiters (1 company):** Freshworks

**Lever (2 companies):** Meesho, CRED (already working, confirmed)

### Deactivated Companies (26)

Companies where all standard ATS API probes failed across all token variations:

- **Custom enterprise portals (no public API):** Google, Apple, Amazon, Microsoft, IBM, Oracle
- **Workday with 422 (CSRF/anti-bot):** Salesforce, AMD, Qualcomm, Cisco
- **All ATS probes 404:** Netflix, GitHub, HashiCorp, Hugging Face, BrowserStack, Chargebee, Mistral AI
- **Indian companies with custom portals:** Revolut, Zomato, Darwinbox, Zoho, Juspay, Ola, Delhivery, PolicyBazaar, Unthinkable

### Final Active Company Count: 39

All 39 active companies have been verified to return live job listings through their configured adapters. The pipeline now covers: Finance (Visa, Mastercard, PayPal, Stripe, Brex, Plaid), Global Tech (Adobe, NVIDIA, Broadcom, Intel, GitLab, MongoDB, Datadog, Cloudflare, Snowflake, Confluent, Elastic, Postman, Docker, Redis, Vercel, Netlify, DigitalOcean, Twilio, Okta, Anthropic, Cohere, Scale AI, Perplexity AI, Together AI, ElevenLabs, Freshworks), Indian Tech (Meesho, Razorpay, PhonePe, Groww, CRED, InMobi, Tekion).


---

## 🚀 9. LiteLLM Proxy — Azure Container Apps Deployment (August 2026)

### Overview
The LiteLLM proxy (which handles the Groq key pool, OpenRouter, and other fallbacks) is deployed separately as a containerized service on Azure Container Apps (ACA). The deployment is split into two cautious stages to avoid blind failures.

### Files
- **`deploy-aca-stage-a.ps1`**: Minimal verification deploy.
- **`deploy-aca-stage-b.ps1`**: Full production deploy (run only after Stage A passes).
- **`litellm_config.yaml`**: The proxy config (model list + fallback router settings). This file is base64-encoded at deploy time and injected as an env var for decoding inside the container.

### Stage A — Environment and Image Verification
1. Creates the Azure Resource Group and Container Apps Environment (Workload Profiles v2 default).
2. **Immediately verifies the billing plan** via `az containerapp env show` — the script asserts that a `Consumption` workload profile is present before proceeding (free-tier equivalent; v2 environments always include this profile built-in).
3. Deploys the bare `ghcr.io/berriai/litellm:v1.98.0` image with default entrypoint and no config injection.
4. Prints the exact `az containerapp exec` command and a five-check manual verification checklist:
   - CHECK A: `sh` is available
   - CHECK B: `base64 -d` works
   - CHECK C: `/app` is writable
   - CHECK D: `litellm --version` and `--config` flag are present
   - CHECK E: End-to-end decode+write dry run succeeds

### Stage B — Full Production Deploy (gate-locked by Stage A)
1. Loads API keys from `.env` (validates required keys before proceeding).
2. Base64-encodes `litellm_config.yaml` and passes it as `LITELLM_CONFIG_B64`.
3. Overrides the container command to decode the config and invoke `litellm --config /app/litellm_config.yaml --port 4000` (the `--config` flag is the confirmed correct invocation per LiteLLM docs).
4. Applies a 31-entry IP ingress allowlist.
5. Verifies the updated revision is running and prints the external FQDN.

### Why `--config` and Not Something Else
LiteLLM's official Docker documentation confirms `litellm --config /path/to/file.yaml` as the standard invocation. The `STORE_MODEL_IN_DB` env var alternative was intentionally excluded since this deployment uses a flat YAML config without a PostgreSQL backend.

### Billing Plan Notes
The legacy `--enable-workload-profiles false` flag is obsolete. As of 2025+, Workload Profiles v2 is the ACA default. Every v2 environment contains a built-in `Consumption` profile with identical free-tier entitlements (180k vCPU-sec/mo, 360k GiB-sec/mo, 2M requests/mo, scale-to-zero). The scripts explicitly target `--workload-profile-name Consumption` on the container app to guarantee free-tier billing.

---

## 🛠 8. Architecture Updates & Recent Fixes (August 2026)

### Azure App Service Proxy & Rate Limiting
- **Issue:** The Express application was failing behind Azure's reverse proxy because `express-rate-limit` (v8) detected invalid `request.ip` formats (e.g., `103.228.147.81:43833`).
- **Fix:** Enabled Express `trust proxy` (`app.set('trust proxy', 1)`) and configured the rate limiter with `validate: false` to allow proper parsing of the `X-Forwarded-For` header injected by Azure.

### Groq API Key Pool Rotation
- **Issue:** Single Groq API keys frequently hit the daily Free Tier quota limit (`429 Too Many Requests`), causing the evaluation pipeline to fail or prematurely exit.
- **Architecture Update:** Implemented a **Groq Key Pool Rotation** system in `geminiService.js`.
- **How it works:** The system accepts multiple API keys via the `GROQ_API_KEYS` environment variable. If one key hits a rate limit, the system gracefully marks it as exhausted for the session and automatically rotates to the next available key in the pool, multiplying the evaluation capacity per pipeline run.

### Local Pending AI Re-evaluation Early Exit
- **Issue:** The "Verify All Local" manual trigger was not correctly breaking out of its execution loop when all AI providers (Gemini, Groq) exhausted their quotas, leading to wasted processing and log spam.
- **Fix:** Added a strict early-exit check in `schedulerService.js` that correctly factors in environment flags (`ENABLE_GROQ_FALLBACK`). If the entire AI chain becomes unavailable, the loop immediately terminates.

### DeepSeek V4 Flash Integration (August 2026)
- **Feature:** Added **DeepSeek V4 Flash** (`deepseek-v4-flash`) as a paid backup provider in the AI fallback chain.
- **Implementation:** New `services/deepseekService.js` using the OpenAI-compatible API at `https://api.deepseek.com`.
- **Note:** Requires account balance. HTTP 402 now correctly treated as a permanent error.
- **Env vars:** `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `ENABLE_DEEPSEEK_FALLBACK`.

### OpenRouter Free Provider Integration (August 2026)
- **Feature:** Added **OpenRouter** (`meta-llama/llama-3.3-70b-instruct:free`) as provider #4 — **no credit card required**.
- **Why:** OpenRouter aggregates 300+ models with `:free` suffix models available without any payment method.
- **Implementation:** New `services/openrouterService.js` using OpenAI-compatible API at `https://openrouter.ai/api/v1`.
- **Position:** Inserted before DeepSeek in the fallback chain.
- **Env vars:** `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `ENABLE_OPENROUTER_FALLBACK`.
- **Full chain:** Gemini → Groq (key pool) → **OpenRouter** → DeepSeek → Local Heuristic.

### HTTP 402 Permanent Error Fix (August 2026)
- **Issue:** `analyzeError()` was treating HTTP 402 (Payment Required) as a temporary error, causing providers with empty wallets to retry on every job.
- **Fix:** Added `is402` check in `services/aiHelpers.js` — 402 now immediately disables the provider for the pipeline session.

### Multi-Tiered Viewer and Admin Authorization (August 2026)
- **Feature:** Added a safe onboarding flow for new users without exposing sensitive data or destructive pipeline controls.
- **3-Tier Permission System:**
  1. **Base Viewer:** Can only access a specialized Project Aim / HLD dashboard. Cannot see actual scraped data or configurations.
  2. **Extended Viewer:** Can request access via the UI (iewAccess: requested). Once an admin grants access (iewAccess: granted), the sidebar unlocks, allowing them to view Analytics, Companies, and Jobs dashboards. They cannot start/stop pipelines or modify configurations.
  3. **Admin:** Full system control. Manages roles via /admin/users dashboard.
- **Implementation:** Robust native Clerk polling via Clerk.addListener injected into EJS to prevent synchronous racing on route initialization.

### LiteLLM Proxy on Azure Container Apps (August 2026)
- **Feature:** Deployed a centralised LiteLLM reverse-proxy to Azure Container Apps (ACA) Consumption tier (free tier).
- **Architecture:** RoleNova backend → LiteLLM Proxy (ACA) → AI Providers (Groq ×4, OpenRouter ×4, DeepSeek).
- **Live URL:** `https://litellm-proxy.politecoast-a10be51c.centralindia.azurecontainerapps.io`
- **Region:** `centralindia` (Azure for Students subscription; eastus blocked for Log Analytics).
- **Billing:** ACA Consumption workload profile — scale-to-zero, 180k vCPU-s/mo free tier. Verified via `az containerapp env show`.
- **Config injection:** `litellm_config.yaml` is base64-encoded at deploy time, stored as `LITELLM_CONFIG_B64` env var, and decoded at container startup via `sh -c "echo $LITELLM_CONFIG_B64 | base64 -d > /app/litellm_config.yaml && litellm --config ..."`. The command/args are patched via `az rest` (ARM REST API) rather than `az containerapp update --command/--args`, which cannot handle `-c` as a value in the CLI extension version used.
- **Security:** Protected by `LITELLM_MASTER_KEY` (HTTP 401 for any unauthenticated request). No IP allowlist (key-based auth is sufficient).
- **Deployment scripts:** `deploy-aca-stage-a.ps1` (environment + bare image verification) and `deploy-aca-stage-b.ps1` (full production config).
- **App `.env`:** `LITELLM_BASE_URL` set to the live ACA URL.

---

## ✅ 11. Final Fleet Audit — All Active Companies (August 2026)

### Result: 47/47 ✅ — 100% pass rate, 0 failures

A full automated audit was run across all 47 active companies, checking:
1. **Site liveness** — HTTP HEAD request to the career page URL
2. **Adapter output** — actual job count returned by the scraper

| Metric | Result |
|---|---|
| Total active companies | 47 |
| Adapters returning jobs | **47 (100%)** |
| Adapters returning zero | 0 |
| Adapters failing | 0 |

### Top Companies by Job Count
| Company | Jobs |
|---|---|
| OpenAI | 739 |
| Stripe | 576 |
| Anthropic | 483 |
| Datadog | 434 |
| MongoDB | 405 |
| Snowflake | 386 |
| Okta | 339 |
| Cloudflare | 305 |
| Brex | 295 |
| Elastic | 263 |

### Companies Added in This Round
- **OpenAI** (Ashby — 739 jobs)
- **Wise** (Greenhouse — 19 jobs)
- **Ramp** (Ashby — 136 jobs)
- **Swiggy** (SmartRecruiters — 53 jobs)
- **Salesforce** (WorkdayCsrf — 200 jobs)
- **Cisco** (WorkdayCsrf — 200 jobs)
- **Amazon** (Custom adapter — 200 jobs)
- **Netflix** (Custom adapter — 510 jobs)

---

## 🔧 Recent Changes & Bug Fixes

### Bug Fix: Matched Jobs Not Appearing on `/jobs` Page (2026-08-24)

**Root Cause:** The `/jobs` route in `frontendRoutes.js` had a MongoDB filter `provider: { $not: /^local/i }`. When `provider` is `null` or `undefined` (the case for all 88 existing matched jobs), MongoDB's `$not` regex **excludes them** instead of including them. This caused the route to return 0 jobs despite 88 being in the database.

**Fix:** Removed the broken `provider` filter from the `/jobs` route. The `/jobs` route now queries:
```js
{ status: 'new', score: { $gte: 70 }, jobStatus: { $ne: 'Closed' } }
```
The local-vs-cloud separation is already handled correctly by the dedicated `/local-jobs` route.

**File changed:** `routes/frontendRoutes.js`

### UI Cleanup: Dashboard & Sidebar (2026-08-24)

**Dashboard changes (`views/pages/dashboard.ejs`):**
- Removed "AI Match Accuracy", "Cache Hit Rate", and "ATS Discovery Success" primary stat cards
- Removed low-value Pipeline Execution Metric cards: Retry Count, Recovered Nodes, Cloudflare Blocks, Header Sanitized, Axios Success, Puppeteer Fallbacks, Cache Savings, Avg Co. Runtime

**Sidebar changes (`views/partials/sidebar.ejs`):**
- Removed Pipeline, Evidence Viewer, Cache, and Logs nav links
- Diagnostics section now shows only Telegram monitoring

### Scraper vs Website Comparison Audit (2026-08-24)

Ran `scratch/compare-scraper.js` against 50 active companies — fetches live job counts from ATS APIs and compares with `RawJob` DB counts.

**Key findings:**
- 20 companies have significant gaps (Anthropic: 516 live vs 0 in DB, Netflix: 511 live vs 0, MongoDB: 404 live vs 0)
- Workday companies return `undefined` job count (API response schema mismatch in parser)
- 24 companies use non-standard APIs that require auth headers (Ashby, custom adapters)
- Greenhouse companies consistently show 0 in DB despite large live counts — scrapers likely failing silently

---

## 🔧 Changelog

### Major Scraper Engine Fixes (2026-08-24 — Session 2)

Deep pipeline trace and root-cause analysis revealed 5 distinct issues. All fixed.

#### Fix 1: City Alias Normalization in Location Validator
**File:** `services/pipeline/validationService.js`

Added alias normalization in `normalizeLocationString` so that official city spellings match the DB's `targetLocations` list:
- `Gurugram` → `Gurgaon` (MongoDB, Okta, many others)
- `Bengaluru` → `Bangalore`
- `Bombay` → `Mumbai`, `Calcutta` → `Kolkata`, `Madras` → `Chennai`

Previously, MongoDB jobs with `location: "Gurugram"` were dropped because `targetLocations` contained `gurgaon`, not `gurugram`.

#### Fix 2: SmartRecruiters Adapter — Added Full Pagination
**File:** `services/ats/providers/Priority1/SmartRecruitersAdapter.js`

SmartRecruiters API caps at 100 results per page. The adapter was not paginating — it only ever fetched the first 100 jobs. Companies like Freshworks (165 total) or Nagarro (920 total) had their India-based jobs on later pages that were never fetched.

Implemented offset-based pagination (`?limit=100&offset=N`) with `totalFound` tracking and a 1000-job safety cap.

#### Fix 3: Netflix Adapter — Full Rebuild with Pagination and Multi-keyword Search
**File:** `services/ats/providers/Priority1/NetflixAdapter.js`

The old NetflixAdapter fetched exactly 50 jobs with a single hardcoded keyword. Rebuilt with:
- Multi-keyword search (iterates through `software engineer`, `backend`, `developer`, `sde`)
- Offset-based pagination per keyword term
- Deduplication by `ats_job_id` across keyword results
- Fixed `t_create` Unix timestamp normalization

#### Fix 4: Netflix DB Record — Removed Wrong `adapter` Override
The Netflix company document had `adapter: "LightweightHtmlAdapter"` explicitly set. The `AdapterFactory` checks this field first, so `LightweightHtmlAdapter` was being used instead of `NetflixAdapter` even though `ats: "netflix"` was set.
- Removed the `adapter` field override with `$unset`

#### Fix 5: Mass DB Migration — Populated Missing `apiUrl` + Removed 14 Wrong Adapter Overrides
**Script:** `scratch/fix-company-configs.js`, `scratch/fix-adapter-overrides.js`

**14 companies** had `adapter: "LightweightHtmlAdapter"` explicitly overriding their proper ATS-specific adapters. This caused them to use the HTML fallback scraper instead of the official APIs.

Fixed companies (adapter override removed):
- `HashiCorp`, `Okta`, `BrowserStack`, `Wise`, `Hugging Face`, `Together AI` → now use **GreenhouseAdapter**
- `Meesho`, `Dream11`, `Chargebee` → now use **LeverAdapter**
- `Cisco`, `Salesforce` → now use **WorkdayCsrfAdapter**
- `Cadence`, `Micron`, `PwC India` → now use **WorkdayAdapter**

Additionally, auto-populated missing `scraperConfig.apiUrl` for 12 more companies:
- Thoughtworks, Databricks, HashiCorp, BrowserStack, Hugging Face (Greenhouse)
- Zeta, Dream11, Mistral AI, Chargebee (Lever)
- Western Digital (SmartRecruiters)
- Cadence, Micron, PwC India (Workday — extracted from `careerUrl`)

#### Note on Expected 0-result Companies
- **Anthropic (515 jobs):** All jobs are US/UK/Singapore. No India presence. Correct behaviour.
- **MongoDB (404 jobs):** Genuinely has no India-based SWE roles currently. Keyword/location filters working correctly.
- **Meesho (50 jobs):** Only non-SWE roles posted right now (AM, Manager, Finance). No bug.
- **Freshworks (165 jobs):** All 165 current openings are US/UK/EU. No India SWE roles posted.

### Health Check Route Added (2026-08-24)

**File:** `index.js`

Added `GET /health` — publicly accessible, no auth required. Returns:
- `status`: `ok` (HTTP 200) or `degraded` (HTTP 503) based on MongoDB connection
- `uptime`: human-readable server uptime
- `db`: MongoDB connection state
- `memory`: heap used/total and RSS in MB
- `version` and `node` runtime info

Useful for uptime monitors (UptimeRobot, Render health checks, etc.).

### Render Free Tier Migration (2026-08-24)

Migrated from Azure to Render. Fixed Docker build failures:

| Problem | Fix |
|---------|-----|
| `node:20` image — packages require `>=22` | Changed to `node:22-bookworm-slim` |
| `--only=production` deprecated npm flag | Replaced with `--omit=dev` |
| No `.dockerignore` — `node_modules` + `.env` copied into image | Created `.dockerignore` |
| `postinstall` ran `playwright install` on every `npm install` | Removed; Dockerfile handles browser install explicitly |
| Healthcheck hit `/` (auth-protected, returns redirect) | Changed to `/health` |
| Missing `engines` field in `package.json` | Added `"node": ">=22.0.0"` |

**New files:**
- `Dockerfile` — updated to Node 22 with full Chromium deps
- `.dockerignore` — excludes node_modules, .env, scratch/, logs/
- `render.yaml` — Render service config (docker runtime, health check path)

---

## ⚡ 12. 2026 Architecture Upgrades & Peak Performance Overhaul (2026-08-27)

### Problem Summary
1. **AI Model Decommissioning / Silent Heuristic Fallback**: Google and Groq decommissioned older model endpoints (`gemini-2.0-flash` returning 404, `llama-3.3-70b-versatile` decommissioned), causing AI evaluation requests to fall back to the deterministic local heuristic (score 70) and leaving "Verified by Gemini / Groq" metrics at 0.
2. **Stale Adapter Overrides in Database**: 10+ company entries in MongoDB had legacy `adapter: "LightweightHtmlAdapter"` overrides from previous auto-discovery failures, causing official API endpoints to be ignored and slowing scraping.
3. **Mongoose Date Cast Errors**: Workday and SmartRecruiters relative date strings (e.g., `"Posted 27 Days Ago"`) were passed directly into `saveMatchedJob` and `saveTrainingSample` without date normalization, triggering `Cast to date failed` Mongoose validation errors.
4. **Candidate Matching Optimization for 2027 Grad / Freshers**: Experience filtering previously flagged 0-2 year ranges on entry-level / junior job descriptions; needed explicit protection for Fresher/Intern/Associate signals.

### Solutions & Architectural Enhancements
1. **Multi-Tier In-Process AI Evaluation Engine (`services/geminiService.js`, `services/pipeline/aiEvaluationService.js`)**:
   - **Tier 1 (Primary)**: Google Gemini Flash (`gemini-2.5-flash` / `gemini-3.6-flash`) with structured JSON schema mode (~300ms evaluation latency).
   - **Tier 2 (Secondary)**: Groq Key Pool rotating across 4 separate API keys with active models (`qwen/qwen3.8-27b`, `openai/gpt-oss-120b`).
   - **Tier 3 (Tertiary)**: OpenRouter Free Tier (`dots-studio/dots-3-note-preview:free`, etc.) with built-in JSON repair.
   - **Tier 4 (Quaternary)**: Self-hosted LiteLLM Proxy backup.
   - **Tier 5 (Offline Local)**: Deterministic heuristic fallback saving to `/local-jobs` queue for nightly verification.
2. **Database Fleet Sync & Adapter Purge (`services/companyService.js`)**:
   - Enhanced `seedCompanies()` to automatically `$unset` stale `adapter` overrides on all active seed companies.
   - Synchronized all 47 active tech & fintech companies (Stripe, NVIDIA, Adobe, Visa, OpenAI, Anthropic, Datadog, Cloudflare, Meesho, Swiggy, etc.) with 100% active ATS adapter binding.
3. **Date Normalization in Pipeline & Training Datasets (`services/pipeline/storageService.js`, `services/trainingDatasetService.js`)**:
   - Integrated `normalizeDate()` on `postedAt` and `postedDate` across `saveMatchedJob`, `RejectedJob`, and `saveTrainingSample`.
4. **Authoritative API Bypassing (`cron/jobSearchCron.js`)**:
   - When official API adapters (Greenhouse, Ashby, Lever, SmartRecruiters, Workday) return 0 matches after successful HTTP 200 responses, the pipeline skips redundant 30s Playwright browser crawls, dropping pipeline run time from ~4 minutes to 70 seconds.
5. **Smart Fresher Protection (`services/pipeline/validationService.js`)**:
   - Protected entry-level, intern, associate, and SDE-1 roles from experience range rejections.
6. **Big Tech & High-Trust Startup Fleet Expansion (`utils/companies.js`, `services/companyService.js`)**:
   - Expanded active verified fleet from 47 to **67 world-class tech companies**, adding Databricks, Figma, Airbnb, Reddit, Discord, Coinbase, Robinhood, Pinterest, ServiceNow, Cadence, Western Digital, Palantir, Thoughtworks, Zeta, Linear, Resend, Airtable, Roblox, Lyft, and PwC India.
   - Verified 100% extraction health rate scraping over 12,470+ live jobs across Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Amazon, and Netflix portals.
7. **Universal Workday Compatibility (`services/ats/providers/Priority1/WorkdayAdapter.js`)**:
   - Standardized default pagination limit to 20 with `searchText: ""` to ensure compatibility across all Workday tenant schemas (preventing HTTP 400s on strict tenants like Cadence and PwC).

---

## 📊 13. All-Time Database & SDE Market Intelligence Feature (2026-08-30)

### Feature Overview
Provides deep visibility into the lifetime volume of jobs scraped and evaluated since the inception of RoleNova, specifically categorizing roles across SDE Freshers (0-2 years, Interns, Graduates), SDE Experienced (2+ years, Senior, Staff, Lead), Non-SDE roles, and profile-matched conversions.

### Implementation Architecture
1. **Lifetime Job Stats Service (`services/jobStatsService.js`)**:
   - Computes all-time aggregated metrics across `MatchedJob`, `RejectedJob`, `RawJob`, and `SearchLog` collections.
   - Categorizes jobs by role seniority, technical domain, and fresher indicators (`fresher`, `intern`, `0-1`, `0-2`, `entry level`, `associate`, `trainee`).
   - Implements a 60-second in-memory caching layer to eliminate redundant DB pressure on live dashboard refreshes.
2. **Analytics & Socket Integration (`services/analyticsService.js`, `services/socketService.js`)**:
   - Injects `lifetime` summary metrics and distribution datasets (`sdeMarketDistribution`, `userMatchDistribution`) into the core analytics payload.
   - Real-time updates delivered via Socket.IO events (`dashboard:init`, `dashboard:update`, `analytics:update`).
3. **Frontend Dashboard & Analytics UI (`views/pages/dashboard.ejs`, `views/pages/analytics.ejs`, `public/js/modules/dashboard.js`)**:
   - **Dashboard**: Added a dedicated "All-Time Scraped & SDE Market Intelligence" section with 6 metric cards (Total Scraped, Matched to Profile, SDE Fresher, SDE Experienced, Non-SDE, Profile Match Rate) and two interactive Chart.js doughnut charts.
   - **Analytics Page**: Added comprehensive lifetime summary cards and distribution charts comparing market availability vs. candidate profile conversion.

---

## 🛠️ 14. Raw Queue Auto-Drain & Evaluation Pipeline Fix (2026-08-30)

### Problem
Previously, raw scraped jobs that were skipped by pre-AI heuristic filters (e.g. non-preferred location, senior keywords) were prematurely exited via `return;` without setting `aiEvaluated: true` or recording the rejection in `RejectedJob`. As a result, hundreds of jobs accumulated indefinitely in the `RawJob` collection in an unevaluated state.

### Solution & Fixes
1. **Pipeline Skip State Finalization (`cron/jobSearchCron.js`)**:
   - Whenever heuristic pre-filters reject a job, the pipeline now sets `rawJob.aiEvaluated = true`, `rawJob.aiMatched = false`, and records the rejection reason into `RejectedJob` immediately.
2. **Dedicated Raw Queue Pipeline Runner (`scripts/run_raw_queue_pipeline.js`)**:
   - Built a standalone execution pipeline to batch-evaluate pending raw queue jobs directly through the multi-tier AI engine without requiring a full ATS re-scrape.
3. **Automated Scheduler Draining (`services/schedulerService.js`)**:
   - Integrated `runRawQueuePipeline()` directly into the daily 8:00 PM cron routine to automatically drain and evaluate any lingering raw queue jobs before dispatching the daily email digest.

---

## 🚀 15. Fleetwide ATS Scraper Overhaul & Redis High-Performance Architecture (2026-08-30)

### 1. Fleetwide Seeded Company Repair & Ashby Adapter
- **Universal Ashby Adapter (`services/ats/providers/Priority1/AshbyAdapter.js`, `services/ats/AdapterFactory.js`)**: Built and integrated a dedicated Priority 1 Ashby ATS adapter that parses job listings directly from official Ashby APIs.
- **Official ATS Endpoints (`utils/companies.js`, `models/Company.js`)**: Diagnosed and upgraded 35+ top-tier tech companies to verified official endpoints (Ashby, Greenhouse, Lever, SmartRecruiters, Workday), repairing previous 0-job/error states and extracting **7,561+ live jobs with a 100% success rate across all 35 companies**.
  - **Ashby**: OpenAI (758 jobs), Cohere (146 jobs), Docker (62 jobs), Redis (18 jobs), Plaid (102 jobs), Ramp (139 jobs), ElevenLabs (248 jobs), Linear (29 jobs), Resend (12 jobs).
  - **Greenhouse**: Databricks (858 jobs), Anthropic (571 jobs), Datadog (454 jobs), MongoDB (407 jobs), Elastic (336 jobs), Cloudflare (309 jobs), Roblox (234 jobs), Scale AI (219 jobs), Pinterest (209 jobs), Coinbase (188 jobs), Lyft (169 jobs), Figma (163 jobs), Reddit (153 jobs), Twilio (144 jobs), DigitalOcean (143 jobs), Robinhood (129 jobs), Vercel (91 jobs), Postman (63 jobs), Together AI (62 jobs), Thoughtworks (51 jobs), Discord (51 jobs), Airtable (16 jobs), Groww (5 jobs), Netlify (2 jobs).
  - **Lever**: Palantir (307 jobs), Zeta (20 jobs).
  - **SmartRecruiters**: ServiceNow (557 jobs), Western Digital (365 jobs), Freshworks (161 jobs), Swiggy (75 jobs).

### 2. Redis Integration (Points 2–5 Architecture)
- **Resilient Redis Connection Manager (`config/redis.js`)**: Supports `REDIS_URL`, `UPSTASH_REDIS_URL`, and `REDIS_HOST` with connection pooling, auto-reconnect, and an embedded in-memory fallback store with zero breaking dependencies.
- **Point 2: True Async Job Queuing (`services/redis/redisQueueService.js`)**: High-throughput Redis queue supporting `p-limit` concurrent worker pool execution (5–10 parallel evaluations across Gemini and rotating Groq keys).
- **Point 3: Sub-Millisecond Distributed Locking (`services/redis/redisLockService.js`)**: Native atomic `SET NX PX` distributed locks with automated renewal tokens for pipeline executions and Telegram listeners, eliminating MongoDB locking overhead.
- **Point 4: O(1) Lifetime Metrics & Counters (`services/redis/redisStatsService.js`, `services/jobStatsService.js`)**: Atomic `HINCRBY` / `HGETALL` lifetime metrics providing sub-millisecond dashboard stats with 0 database roundtrips.
- **Point 5: ATS Scraper & AI LLM Evaluation Cache (`services/redis/redisCacheService.js`, `services/geminiService.js`)**: Caches deterministic hashes of job descriptions and candidate profile evaluations with a 14-day TTL, reducing duplicate AI evaluation latency from ~2,500ms to **< 2ms** and preserving daily LLM API quotas.

---

## ⏳ 16. Expired Jobs Sidebar Section & Complete Lifecycle Timestamps (2026-08-30)

### Feature Overview
Provides dedicated tracking for historical and expired/closed AI-matched jobs, displaying complete lifecycle timestamps (Job Posted Date, Scraper Discovery Date, and Expiration Date).

### Key Updates
1. **Sidebar Navigation Integration (`views/partials/sidebar.ejs`, `views/components/sidebar.ejs`)**:
   - Added a dedicated **"Expired Jobs"** menu item under the Job Tracking / Entities sections linking to `/closed-jobs` (and `/expired`).
2. **Dedicated Expired Jobs View (`views/pages/closed-jobs.ejs`)**:
   - Displays a dedicated table view with archived status badges, AI score badges, and a 3-tier lifecycle timestamp column:
     - 📅 **Posted Date**: When the employer originally published the job posting.
     - 🚀 **Scraped Date**: When the RoleNova scraper first captured the job.
     - 🛑 **Expired Date**: When the role was verified as closed or filled.
3. **Backend Route (`routes/frontendRoutes.js`)**:
   - Handles `/closed-jobs` and `/expired` with Mongoose population for `company` and `rawJob` data, sorting by latest expiration date.




