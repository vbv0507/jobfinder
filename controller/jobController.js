const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");

const runSearch = require("../cron/jobSearchCron");
const { generateReport } = require("../services/reportService");

const sendError = (res, error) =>
    res.status(500).json({
        success: false,
        message: error.message,
    });

// Shows every job saved by the scraper.
const getRawJobs = async (req, res) => {
    try {
        const jobs = await RawJob.find().sort({ scrapedAt: -1 });

        res.status(200).json({
            success: true,
            count: jobs.length,
            jobs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

// Shows only jobs selected by Gemini.
const getMatchedJobs = async (req, res) => {
    try {
        const jobs = await MatchedJob.find().sort({ score: -1 });

        res.status(200).json({
            success: true,
            count: jobs.length,
            jobs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

// Shows cron history: when it ran, how many jobs it found, and errors.
const getSearchLogs = async (req, res) => {
    try {
        const logs = await SearchLog.find()
            .sort({ createdAt: -1 })
            .limit(50);

        res.status(200).json({
            success: true,
            count: logs.length,
            logs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

// Report is the dashboard-friendly sorted matched-job list.
const getReport = async (req, res) => {
    try {
        const jobs = await generateReport();

        res.status(200).json({
            success: true,
            count: jobs.length,
            jobs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

// Manual trigger for testing from Postman.
const runJobSearch = async (req, res) => {
    try {
        await runSearch();

        res.status(200).json({
            success: true,
            message: "Job search completed",
        });
    } catch (error) {
        sendError(res, error);
    }
};

module.exports = {
    getRawJobs,
    getMatchedJobs,
    getSearchLogs,
    getReport,
    runJobSearch,
};
