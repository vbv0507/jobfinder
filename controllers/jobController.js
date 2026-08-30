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

const getRejectedJobs = async (req, res) => {
    try {
        const RejectedJob = require("../models/RejectedJob");
        const jobs = await RejectedJob.find()
            .populate("company", "name logo domain")
            .populate("rawJob")
            .sort({ score: -1, lastScrapedAt: -1 })
            .lean();

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
        if (pipelineState.running) {
            console.log(`[Controller] 409 Conflict: Pipeline is already running.`);
            await logAuditAction(req, 'Pipeline Trigger', 'Skipped - Already running');
            return res.status(409).json({
                success: false,
                message: "Pipeline is already running."
            });
        }

        const { isSuperAdminUser } = require("../middleware/authMiddleware");
        const User = require("../models/User");
        const isSuperAdmin = isSuperAdminUser(req.user);

        // Calculate today's date in IST (YYYY-MM-DD)
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDateStr = new Date(now.getTime() + istOffset).toISOString().split('T')[0];

        if (!isSuperAdmin && req.user && req.user._id) {
            const user = await User.findById(req.user._id);
            if (user) {
                const isSameDay = user.lastPipelineRunDate === istDateStr;
                const runsToday = isSameDay ? (user.dailyPipelineRuns || 0) : 0;

                if (runsToday >= 1) {
                    return res.status(429).json({
                        success: false,
                        limitReached: true,
                        message: "Daily Pipeline Run Limit Reached (1/1 used today). Your run limit resets at midnight IST. (Super-Admin vbvrai1407 has unlimited runs)."
                    });
                }

                user.dailyPipelineRuns = runsToday + 1;
                user.lastPipelineRunDate = istDateStr;
                user.lastPipelineRunAt = now;
                await user.save();
            }
        }

        const force = req.query.force === 'true' || (req.body && (req.body.force === true || req.body.force === 'true'));
        
        // Start async execution
        runSearch(`Manual (${req.user?.fullName || req.user?.email || 'User'})`, force).catch(e => console.error("Manual pipeline failed", e));
        
        await logAuditAction(req, 'Pipeline Trigger', `Success by ${req.user?.email || 'User'}`);
        
        res.status(202).json({
            success: true,
            message: "Job search started",
            runsRemaining: isSuperAdmin ? "Unlimited" : 0
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

        const CacheManager = require("../services/cacheManager");
        const { invalidateAnalyticsCache } = require("../services/analyticsService");
        CacheManager.invalidate();
        invalidateAnalyticsCache();

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
    getReport,
    getRejectedJobs,
    runJobSearch,
    stopJobSearch,
    updateJobStatus,
    deleteRawJobs,
};
