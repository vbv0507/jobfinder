# RoleNova v2.0 🚀

RoleNova is an intelligent, high-performance ATS Discovery and Job Scraping Engine. Built for scale and reliability, it automatically traverses company career pages, scrapes job listings, evaluates them against a Candidate Profile using AI (Gemini / Groq / Z.ai), and alerts you of matching opportunities.

## ✨ Features

- **Automated ATS Discovery**: Automatically detects and parses Greenhouse, Lever, Workday, SmartRecruiters, and standard HTML job boards.
- **Self-Healing Retry Chain**: Automatically intercepts network errors and rate limits, applying anti-bot headers and adaptive retries.
- **Smart Caching**: Saves Playwright resources by caching previously scraped companies for 12 hours.
- **AI Evaluation**: Integrates with Google Gemini, Groq, and Z.ai to evaluate job requirements against your exact career profile, filtering out senior roles or unaligned domains.
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

### Azure App Service
1. Connect your GitHub repository to Azure App Service.
2. Ensure you add all variables from `.env.example` into Azure's **Configuration > Application Settings**.
3. Set Startup Command to `npm start`.

### GitHub Actions
A `.github/workflows/deploy.yml` can be created to trigger deployments on `git push origin main`.

## 🛡️ License

RoleNova is licensed under the MIT License.
