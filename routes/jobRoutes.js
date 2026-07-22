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

const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/raw", requireViewer, getRawJobs);
router.get("/matched", requireViewer, getMatchedJobs);
router.get("/grouped", requireViewer, getGroupedJobs);
router.get("/complete", requireViewer, getCompleteJobs);
router.get("/logs", requireViewer, getSearchLogs);
router.get("/status", requireViewer, getPipelineStatus);
router.get("/report", requireViewer, getReport);
router.get("/analytics", requireViewer, getAnalytics);
router.post("/run", requireAdmin, runJobSearch);
router.patch("/:id/status", requireAdmin, updateJobStatus);
router.delete("/raw", requireAdmin, deleteRawJobs);

module.exports = router;
