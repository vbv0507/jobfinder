const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");
const PipelineLock = require("../models/PipelineLock");

const runSearch = require("../cron/jobSearchCron");
const {
    generateReport,
    generateGroupedReport,
    generateMatchedCompanyReport,
} = require("../services/reportService");
const { getAnalyticsData } = require("../services/analyticsService");
const pipelineState = require("../services/pipelineState");
const { logAuditAction } = require("../services/auditService");

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

const getLiveTelemetry = async (req, res) => {
    try {
        const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
        const data = await getAnalyticsData();
        
        let mergedState = { ...pipelineState };
        if (lock && lock.status === "Running" && lock.expiresAt > new Date()) {
            if (!mergedState.running) {
                mergedState.currentStage = "Running (DB Lock)";
                mergedState.runner = lock.runner;
                mergedState.lockStartedAt = lock.startedAt;
                mergedState.lockExpiresAt = lock.expiresAt;
            }
        }
        
        res.status(200).json({
            success: true,
            pipeline: mergedState,
            metrics: data.metrics || {},
            timeline: mergedState.timeline,
            currentCompany: mergedState.currentCompany,
            currentParser: mergedState.currentModel, // Using currentModel or parser from memory
            currentATS: mergedState.currentATS,
            activeBrowserCount: mergedState.activeCompanies ? mergedState.activeCompanies.length : 0,
            queueSize: mergedState.totalCompanies - (mergedState.companyIndex || 0),
            jobsFound: mergedState.jobsFound || data.metrics?.["Raw Jobs"] || 0,
            jobsSaved: mergedState.jobsSaved || 0,
            aiProvider: "Gemini / Groq",
            eta: "Calculating...", // or real ETA if available
            elapsed: mergedState.elapsedTime,
            status: mergedState.currentStage
        });
    } catch (error) {
        sendError(res, error);
    }
};

const getPipelineStatus = async (req, res) => {
    try {
        const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
        
        let mergedState = { ...pipelineState };
        if (lock && lock.status === "Running" && lock.expiresAt > new Date()) {
            if (!mergedState.running) {
                mergedState.currentStage = "Running (DB Lock)";
                mergedState.runner = lock.runner;
                mergedState.lockStartedAt = lock.startedAt;
                mergedState.lockExpiresAt = lock.expiresAt;
            }
        }
        
        res.status(200).json({
            success: true,
            state: mergedState
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
        if (pipelineState.running) {
            console.log(`[Controller] 409 Conflict: Pipeline is already running.`);
            await logAuditAction(req, 'Pipeline Trigger', 'Skipped - Already running');
            return res.status(409).json({
                success: false,
                message: "Pipeline is already running."
            });
        }

        const force = req.query.force === 'true' || (req.body && (req.body.force === true || req.body.force === 'true'));
        
        // Start async execution
        runSearch("Manual", force).catch(e => console.error("Manual pipeline failed", e));
        
        await logAuditAction(req, 'Pipeline Trigger', 'Success');
        
        res.status(202).json({
            success: true,
            message: "Job search started",
        });
    } catch (error) {
        sendError(res, error);
    }
};

const stopJobSearch = async (req, res) => {
    try {
        if (!pipelineState.running) {
            return res.status(400).json({ success: false, message: "Pipeline is not currently running." });
        }
        pipelineState.cancel();
        await logAuditAction(req, 'Pipeline Cancel', 'Success');
        res.status(200).json({ success: true, message: "Cancellation requested." });
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
            { returnDocument: "after" }
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
        await logAuditAction(req, 'Raw DB Delete', `Success - Deleted ${result.deletedCount}`);
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
    stopJobSearch,
    updateJobStatus,
    deleteRawJobs,
    getLiveTelemetry,
};
