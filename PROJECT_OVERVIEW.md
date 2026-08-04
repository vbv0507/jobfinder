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
Instead of relying on a single AI provider (which might rate-limit or fail), RoleNova uses a highly resilient fallback chain to ensure jobs are evaluated quickly and cheaply.

### How it works
The `aiEvaluationService.js` attempts to evaluate a job in the following order:
1. **Gemini 2.0 Flash**: The primary provider (fastest and cheapest). 1,500 req/day free.
2. **Groq / Llama 3.3 70B**: Immediate fallback with **key pool rotation** across multiple accounts. 100K TPD per key.
3. **Z.AI / GLM 4.5**: Tertiary fallback.
4. **Cerebras / Llama 3.3 70B**: Quaternary fallback — **1M tokens/day FREE**, no credit card. ~2600 tok/s.
5. **DeepSeek V4 Flash**: Paid backup ($0.14/1M tokens) via OpenAI-compatible API.
6. **Local Heuristic**: If all cloud providers fail, deterministic keyword-based local evaluation.

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
- **AI Models**: Google Gemini (Primary), Groq/Llama-3 (Secondary, key-pool), Z.AI/GLM (Tertiary), Cerebras/Llama-3.3 (Quaternary, FREE 1M/day), DeepSeek V4 Flash (Paid backup), Local Heuristic (Final fallback)

RoleNova represents a perfect synergy between traditional web scraping and modern Generative AI, creating a zero-touch, highly curated job hunting assistant.

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
- **Issue:** The "Verify All Local" manual trigger was not correctly breaking out of its execution loop when all AI providers (Gemini, Groq, Z.AI) exhausted their quotas, leading to wasted processing and log spam.
- **Fix:** Added a strict early-exit check in `schedulerService.js` that correctly factors in environment flags (`ENABLE_GROQ_FALLBACK`). If the entire AI chain becomes unavailable, the loop immediately terminates.

### DeepSeek V4 Flash Integration (August 2026)
- **Feature:** Added **DeepSeek V4 Flash** (`deepseek-v4-flash`) as a paid backup provider in the AI fallback chain.
- **Implementation:** New `services/deepseekService.js` using the OpenAI-compatible API at `https://api.deepseek.com`.
- **Note:** Requires account balance. HTTP 402 now correctly treated as a permanent error.
- **Env vars:** `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `ENABLE_DEEPSEEK_FALLBACK`.

### Cerebras Free Provider Integration (August 2026)
- **Feature:** Added **Cerebras** (`llama-3.3-70b`) as the 4th free provider — **1M tokens/day, no credit card required**.
- **Why:** Cerebras offers the fastest open-model inference (~2,600 tokens/sec) with the largest free daily token budget of any provider.
- **Implementation:** New `services/cerebrasService.js` using the OpenAI-compatible API at `https://api.cerebras.ai/v1`.
- **Position:** Inserted between Z.AI (#3) and DeepSeek (#5) in the fallback chain.
- **Env vars:** `CEREBRAS_API_KEY`, `CEREBRAS_MODEL`, `CEREBRAS_BASE_URL`, `ENABLE_CEREBRAS_FALLBACK`.
- **Full chain:** Gemini → Groq (key pool) → Z.AI → **Cerebras** → DeepSeek → Local Heuristic.

### HTTP 402 Permanent Error Fix (August 2026)
- **Issue:** `analyzeError()` was treating HTTP 402 (Payment Required) as a temporary error, causing providers with empty wallets to retry on every job.
- **Fix:** Added `is402` check in `services/aiHelpers.js` — 402 now immediately disables the provider for the pipeline session.
