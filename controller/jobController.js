const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");

const runSearch = require("../cron/jobSearchCron");
const {
    generateReport,
    generateGroupedReport,
    generateMatchedCompanyReport,
} = require("../services/reportService");

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

const updateAppliedStatus = async (req, res) => {
    try {
        const applied = req.body.applied === true;
        const job = await MatchedJob.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    applied,
                    appliedAt: applied ? new Date() : null,
                },
            },
            { new: true },
        );

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Matched job not found",
            });
        }

        res.status(200).json({
            success: true,
            job,
        });
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
    getReport,
    runJobSearch,
    updateAppliedStatus,
    deleteRawJobs,
};
