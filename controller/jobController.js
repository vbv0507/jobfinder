const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");

const runSearch = require("../cron/jobSearchCron");
const {
    generateReport,
    generateGroupedReport,
    generateMatchedCompanyReport,
} = require("../services/reportService");
const { getAnalyticsData } = require("../services/analyticsService");
const pipelineState = require("../services/pipelineState");

const sendError = (res, error) =>
    res.status(500).json({
        success: false,
        message: error.message,
    });

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

const getMatchedJobs = async (req, res) => {
    try {
        const jobs = await MatchedJob.find().populate("company", "name").sort({ score: -1 });
        res.status(200).json({
            success: true,
            count: jobs.length,
            jobs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

const getGroupedJobs = async (req, res) => {
    try {
        const jobs = await generateGroupedReport();
        res.status(200).json({
            success: true,
            jobs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

const getCompleteJobs = async (req, res) => {
    try {
        
        const jobs = await generateMatchedCompanyReport();
        res.status(200).json({
            success: true,
            jobs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

const getSearchLogs = async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(50);
        res.status(200).json({
            success: true,
            count: logs.length,
            logs,
        });
    } catch (error) {
        sendError(res, error);
    }
};

const getPipelineStatus = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            state: pipelineState
        });
    } catch (error) {
        sendError(res, error);
    }
};

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

const getAnalytics = async (req, res) => {
    try {
        const data = await getAnalyticsData();
        res.status(200).json({
            success: true,
            ...data
        });
    } catch (error) {
        sendError(res, error);
    }
};

const runJobSearch = async (req, res) => {
    try {
        const result = await runSearch("Manual");
        
        if (result && result.skipped) {
            return res.status(409).json({
                success: false,
                message: "Pipeline is already running."
            });
        }
        
        res.status(200).json({
            success: true,
            message: "Job search completed",
        });
    } catch (error) {
        sendError(res, error);
    }
};

const updateJobStatus = async (req, res) => {
    try {
        const { status, notes } = req.body;
        const updateData = { $set: {} };
        const pushData = { timeline: { status, date: new Date() } };

        if (status) {
            updateData.$set.status = status;
            if (status === "applied") {
                updateData.$set.appliedAt = new Date();
            }
        }
        
        if (notes !== undefined) {
            updateData.$set.notes = notes;
        }

        const job = await MatchedJob.findByIdAndUpdate(
            req.params.id,
            { ...updateData, $push: pushData },
            { new: true }
        );

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        res.status(200).json({ success: true, job });
    } catch (error) {
        sendError(res, error);
    }
};

const deleteRawJobs = async (req, res) => {
    try {
        const result = await RawJob.deleteMany({});
        res.status(200).json({
            success: true,
            message: "All raw jobs deleted",
            deletedCount: result.deletedCount,
        });
    } catch (error) {
        sendError(res, error);
    }
};

module.exports = {
    getRawJobs,
    getMatchedJobs,
    getGroupedJobs,
    getCompleteJobs,
    getSearchLogs,
    getPipelineStatus,
    getReport,
    getAnalytics,
    runJobSearch,
    updateJobStatus,
    deleteRawJobs,
};
