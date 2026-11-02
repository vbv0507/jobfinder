# RoleNova v2.0 🚀

RoleNova is an intelligent, high-performance ATS Discovery and Job Scraping Engine. Built for scale and reliability, it automatically traverses company career pages, scrapes job listings, evaluates them against a Candidate Profile using AI (Gemini / Groq / OpenRouter / DeepSeek), and alerts you of matching opportunities.

## ✨ Features

- **Automated ATS Discovery**: Automatically detects and parses Greenhouse, Lever, Workday, SmartRecruiters, and standard HTML job boards.
- **Self-Healing Retry Chain**: Automatically intercepts network errors and rate limits, applying anti-bot headers and adaptive retries.
- **Smart Caching**: Saves Playwright resources by caching previously scraped companies for 12 hours.
- **AI Evaluation**: Integrates with Google Gemini, Groq, OpenRouter, and DeepSeek to evaluate job requirements against your exact career profile, filtering out senior roles or unaligned domains.
- **Operational Control Center**: A beautiful, real-time dashboard tracking pipeline execution, AI telemetry, parsing statistics, and live logs.
- **Telegram Integration**: Receives job postings via Telegram channels and instantly processes them through the pipeline.

## 🏗️ Architecture

- **Backend**: Node.js + Express
- **Database**: MongoDB (Mongoose)
- **Scraping Engine**: Playwright + Axios + Cheerio
- **Task Scheduling**: node-cron
- **Frontend**: EJS + TailwindCSS + Vanilla JS (No React overhead)

## 📁 Folder Structure

```
jobfinder/
├── config/           # Database and core config
├── controllers/      # Route controllers (MVC)
├── cron/             # Pipeline orchestration (jobSearchCron.js)
├── middleware/       # Clerk Auth & Admin protection
├── models/           # Mongoose schemas
├── public/           # Static frontend assets (Tailwind CSS, Vanilla JS)
├── routes/           # Express routes
├── scripts/          # Utility scripts
├── services/         # Core business logic (ATS, AI, Telegram)
│   ├── ats/          # Parser adapters (Greenhouse, Workday, etc.)
│   └── pipeline/     # Storage, Validation, Discovery Engine
├── utils/            # Shared utilities (Date normalizer, etc.)
└── views/            # EJS templates
```

## 🚀 Quick Start

### 1. Installation

```bash
git clone https://github.com/vbv0507/jobfinder.git
cd jobfinder
npm install
```

### 2. Environment Variables

Copy the provided `.env.example` to `.env` and configure your keys:

```bash
cp .env.example .env
```
*(Ensure you provide MongoDB, Clerk, and AI API keys).*

### 3. Run Locally

```bash
npm start
```
*The server will boot on `http://localhost:5000`.*

## 🌩️ Deployment

### Free hosting split: Render + GitHub Actions

RoleNova is designed to run in three independent parts when a 24x7 server is not available:

| Component | Runs on | Schedule / behavior |
| --- | --- | --- |
| Dashboard | Render web service | Serves pages and APIs only; safe to sleep when inactive. |
| ATS pipeline | GitHub Actions | 7:00 AM IST daily. |
| Telegram sync | GitHub Actions | Every 15 minutes; reads only messages newer than the MongoDB cursor. |
| Daily email digest | GitHub Actions | 8:00 PM IST daily. |

The Render service must use `BACKGROUND_JOBS_ENABLED=false`. This prevents a sleeping/restarting web server from running a second scheduler or Telegram listener. Redis is optional: without `REDIS_URL`, each short GitHub job and the web service use the existing in-memory fallback.

#### 1. GitHub Actions secrets

In **GitHub repository → Settings → Secrets and variables → Actions**, add these repository secrets:

- Required for all jobs: `MONGO_URI`
- Required for Telegram polling: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`
- Add the AI providers you use: `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_API_KEY_1` through `GROQ_API_KEY_4`, `GROQ_API_KEYS`, `ZAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`
- Required for the digest: `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO`

After the workflow files are merged into the repository's **default branch**, use the **Actions** tab to run these once manually, in this order:

1. `RoleNova Pipeline`
2. `RoleNova Telegram Poll`
3. `RoleNova Daily Digest` (only after email secrets are set)

GitHub scheduled workflows execute from the default branch and can be delayed at busy times, so the Telegram workflow is deliberately offset from minute zero. Keep an occasional eye on the Actions tab; on public repositories, GitHub can disable scheduled workflows after 60 days without repository activity.

#### 2. Render dashboard

Create a Render **Web Service** from this repository. The included `render.yaml` is already configured for the Docker deployment. Set these as Render environment variables:

- `MONGO_URI`
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
- Any AI keys needed by dashboard/manual actions
- `SYSTEM_INTERNAL_SECRET` if used in your deployment
- `BACKGROUND_JOBS_ENABLED=false`
- `SEED_COMPANIES_ON_START=false`

Do **not** add Telegram credentials to Render. The GitHub polling job owns that session, which prevents two processes using the same GramJS session at once.

#### 3. MongoDB Atlas

Allow network access for both Render and GitHub Actions. Because their outbound IPs are not fixed on the free tiers, this usually means temporarily allowing `0.0.0.0/0` and using a strong database user/password with the minimum required database permissions.

## 🛡️ License

RoleNova is licensed under the MIT License.
