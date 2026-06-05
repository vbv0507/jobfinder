const express = require("express");

const {
    getRawJobs,
    getMatchedJobs,
    getSearchLogs,
    getReport,
    runJobSearch,
} = require("../controller/jobController");

const router = express.Router();

// GET /api/jobs/raw -> all scraped jobs
router.get("/raw", getRawJobs);

// GET /api/jobs/matched -> only Gemini-approved jobs
router.get("/matched", getMatchedJobs);

// GET /api/jobs/logs -> cron execution history
router.get("/logs", getSearchLogs);

// GET /api/jobs/report -> dashboard/report data
router.get("/report", getReport);

// POST /api/jobs/run -> manually start one search run
router.post("/run", runJobSearch);

module.exports = router;
