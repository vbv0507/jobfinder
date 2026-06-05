# AI Job Finder

AI Job Finder is a Node.js backend project that helps students and fresh graduates discover relevant jobs automatically.

Instead of manually opening company career pages every day, this project:

1. Fetches jobs from company career APIs.
2. Saves all discovered jobs in MongoDB.
3. Filters jobs by location, role, and experience.
4. Sends useful jobs to Gemini AI for resume/profile matching.
5. Saves only high-quality matches for the user dashboard/report.

The current simplified version uses **API-based scraping only** with:

- Visa
- LG

This keeps the project easy to understand, easy to present, and realistic enough for a resume.

## Main Idea

The motive of this project is simple:

> Help a fresher/student find suitable jobs automatically using APIs, MongoDB, cron jobs, and AI matching.

The system works like a mini job recommendation engine.

It does not just store jobs. It also checks whether the job is useful for the candidate profile.

## Tech Stack

- **Node.js**: backend runtime
- **Express.js**: API routes
- **MongoDB + Mongoose**: database and schemas
- **Node-Cron**: scheduled daily search
- **Axios**: calling company job APIs
- **Gemini AI**: job and profile matching

## Project Parts

### 1. `index.js`

This is the starting point of the backend.

It does four main things:

1. Loads environment variables from `.env`.
2. Connects to MongoDB.
3. Seeds companies from `utils/companies.js`.
4. Starts the Express server.

If `RUN_SEARCH_ON_START=true`, it also runs one job search when the server starts.

### 2. `utils/companies.js`

This file stores the companies that should be scanned.

Current companies:

- Visa
- LG

Each company contains:

- company name
- career URL
- API URL
- scraper configuration

### 3. `services/scraperService.js`

This file fetches jobs from company APIs.

It has two scraper styles:

- Generic API scraper for simple APIs like Visa
- LG-specific API scraper because LG has a different JSON format

Every scraped job is converted into one common format:

```js
{
  title,
  location,
  jobId,
  experience,
  description,
  applyLink,
  employmentType,
  postedAt
}
```

This common format makes the rest of the project simple.

### 4. `cron/jobSearchCron.js`

This is the main automation file.

It runs the job search pipeline.

Main work:

1. Get active companies.
2. Get active candidate profile.
3. Scrape jobs from each company.
4. Save every job in `RawJob`.
5. Skip bad jobs before Gemini.
6. Send useful jobs to Gemini.
7. Save good matches in `MatchedJob`.
8. Save run summary in `SearchLog`.

### 5. `services/geminiService.js`

This file sends a job and candidate profile to Gemini.

Gemini returns:

```js
{
  score,
  suitable,
  reason,
  missingSkills,
  roleMatch,
  experienceMatch,
  recommendation
}
```

If the score is good enough, the job is saved as a matched job.

### 6. `models/`

This folder contains MongoDB schemas.

- `Company.js`: company API information
- `CandidateProfile.js`: user profile and preferences
- `RawJob.js`: every scraped job
- `MatchedJob.js`: only AI-approved jobs
- `SearchLog.js`: history of every search run

### 7. `routes/`

Routes define API URLs.

Company routes:

- `GET /api/companies`
- `POST /api/companies`
- `POST /api/companies/seed`

Profile routes:

- `GET /api/profile`
- `POST /api/profile`

Job routes:

- `GET /api/jobs/raw`
- `GET /api/jobs/matched`
- `GET /api/jobs/logs`
- `GET /api/jobs/report`
- `POST /api/jobs/run`

### 8. `controller/`

Controllers receive API requests and call the correct model/service.

Example:

- route receives `/api/jobs/raw`
- controller fetches raw jobs from MongoDB
- controller sends response back to client

### 9. `services/reportService.js`

This returns matched jobs sorted by highest score.

It is useful for a dashboard or report page.

## Execution Pipeline

This is the full flow of the project.

### Step 1: Start Server

Run:

```bash
npm start
```

### Step 2: `index.js` Runs

`index.js` starts first.

It loads `.env`, creates the Express app, and prepares routes.

### Step 3: MongoDB Connects

`connectDB()` connects the backend to MongoDB.

Without MongoDB, jobs cannot be saved.

### Step 4: Companies Are Seeded

`seedCompanies()` reads `utils/companies.js`.

It deletes old company records and inserts the current companies:

- Visa
- LG

This prevents old HTML scraper companies from running.

### Step 5: Server Starts

Express starts on the port from `.env`.

Example:

```txt
Server running on port 5000
```

### Step 6: Job Search Starts

Job search can start in two ways:

1. Automatically every day at 2:00 AM using cron.
2. Manually by calling:

```txt
POST /api/jobs/run
```

If `.env` has `RUN_SEARCH_ON_START=true`, it also runs when the server starts.

### Step 7: Active Companies Are Loaded

The cron gets active companies from MongoDB.

Currently it gets:

- Visa
- LG

### Step 8: Candidate Profile Is Loaded

The cron gets the active candidate profile from MongoDB.

If there is no profile in MongoDB, it uses `profile.js` as fallback.

### Step 9: Jobs Are Scraped

For each company, `scraperService.js` calls the company API.

Example:

- Visa API returns SmartRecruiters jobs.
- LG API returns LG career jobs.

### Step 10: Jobs Are Normalized

Different APIs return different JSON.

The scraper converts every job into the same format.

This makes saving and AI matching easier.

### Step 11: Raw Jobs Are Saved

Every scraped job is saved in `RawJob`.

Raw jobs are saved even if they are not a good match.

This is useful because you can see everything the scraper found.

### Step 12: Simple Filter Runs Before Gemini

Before calling Gemini, the cron checks:

- Is the job location preferred?
- Is the role related to the candidate profile?
- Is it too senior for a fresher?

This saves Gemini quota.

### Step 13: Gemini Analyzes Useful Jobs

Only useful jobs are sent to Gemini.

Gemini gives:

- score
- suitability
- reason
- missing skills
- recommendation

### Step 14: Matched Jobs Are Saved

If Gemini score is greater than or equal to `MATCH_THRESHOLD`, the job is saved in `MatchedJob`.

These are the jobs the user should apply to first.

### Step 15: Search Log Is Saved

At the end, the cron saves a summary in `SearchLog`.

It stores:

- companies scanned
- jobs found
- jobs matched
- errors
- start time
- end time

## How To Run

Install dependencies:

```bash
npm install
```

Start server:

```bash
npm start
```

Manually run job search:

```txt
POST http://localhost:5000/api/jobs/run
```

View raw jobs:

```txt
GET http://localhost:5000/api/jobs/raw
```

View matched jobs:

```txt
GET http://localhost:5000/api/jobs/matched
```

View logs:

```txt
GET http://localhost:5000/api/jobs/logs
```

## Environment Variables

Create a `.env` file:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
GEMINI_API_KEY=your_gemini_api_key
RUN_SEARCH_ON_START=false
SEED_COMPANIES_ON_START=true
MATCH_THRESHOLD=70
MAX_JOBS_PER_COMPANY=10
MAX_AI_EVALUATIONS_PER_RUN=15
STRICT_LOCATION_MATCH=true
```

## Resume Summary

You can describe this project like this:

> Built an AI-powered job discovery backend using Node.js, Express.js, MongoDB, scheduled cron jobs, API-based job scraping, and Gemini AI. The system fetches jobs from company career APIs, stores raw opportunities, filters them using candidate preferences, and uses Gemini to rank suitable jobs by resume match score.

## Current Scope

The project currently focuses on two API-based companies:

- Visa
- LG

This is intentional because API scraping is easier to understand, more stable than HTML scraping, and better for project presentation.
