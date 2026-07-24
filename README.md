# RoleNova v2.0 - The Autonomous Job Scraper

RoleNova is a high-performance, autonomous, and self-healing job scraping engine and SaaS dashboard. It monitors careers pages, discovers new APIs dynamically, extracts job listings using advanced heuristics and Playwright stealth interceptors, and evaluates jobs using an AI Evaluation cascade (Gemini -> Groq -> Local).

## Features

- **Dynamic ATS Discovery**: Never write a custom parser again. The Network Interceptor automatically traces API calls, extracts authentication headers, and builds virtual adapters for ATS providers (Greenhouse, Lever, SmartRecruiters, Workday, etc.).
- **Self-Healing Engine**: Fallbacks for broken endpoints. If an API signature changes, the engine spins up a stealth Playwright instance to bypass Cloudflare and scrape jobs.
- **Smart Cache Layer**: Avoids rate limiting and bans by aggressively caching identical payloads across different endpoints.
- **AI Job Evaluation**: Evaluates jobs against your personal `CandidateProfile` using a multi-provider AI waterfall: Gemini (Primary), Groq (Speed), Local (Llama).
- **Telegram Monitoring**: Parses structured job postings from Telegram channels automatically.
- **Enterprise-Grade Observability**: A comprehensive frontend dashboard showing Pipeline Execution timelines, real-time scraping stats, and system metrics.

## Technology Stack

- **Backend**: Node.js, Express, MongoDB (Mongoose), node-cron
- **Scraping**: Playwright Extra, Puppeteer Stealth, Axios
- **Frontend**: EJS, TailwindCSS, Chart.js, Vanilla ES Modules
- **Authentication**: Clerk

## Setup

1. **Clone & Install**
   ```bash
   git clone https://github.com/vbv0507/jobfinder.git
   cd jobfinder
   npm install
   ```

2. **Configure Environment**
   Copy `.env.example` to `.env` and fill in the values.
   ```bash
   cp .env.example .env
   ```

3. **Start the Engine**
   ```bash
   npm start
   ```
   Or for development (with nodemon):
   ```bash
   npm run dev
   ```

## Production Architecture

RoleNova runs a unified API at `GET /api/system/live` that broadcasts real-time telemetry (lock status, current company, jobs scraped, memory usage). The frontend UI is purely driven by this payload, enabling multiple clients to watch the pipeline execute in real-time without polling the database.

## License
MIT
