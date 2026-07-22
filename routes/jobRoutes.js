const express = require("express");

const {
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
} = require("../controller/jobController");

const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/raw", getRawJobs);
router.get("/matched", getMatchedJobs);
router.get("/grouped", getGroupedJobs);
router.get("/complete", getCompleteJobs);
router.get("/logs", getSearchLogs);
router.get("/status", getPipelineStatus);
router.get("/report", getReport);
router.get("/analytics", getAnalytics);
router.post("/run", requireAdmin, runJobSearch);
router.patch("/:id/status", updateJobStatus);
router.delete("/raw", requireAdmin, deleteRawJobs);

module.exports = router;
