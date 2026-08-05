const express = require("express");

const {
    getRawJobs,
    getMatchedJobs,
    getGroupedJobs,
    getRejectedJobs,
    getCompleteJobs,
    getReport,
    runJobSearch,
    stopJobSearch,
    updateJobStatus,
    deleteRawJobs,
} = require("../controllers/jobController");

const { requireAdmin, requireExtendedViewer } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/raw", requireExtendedViewer, getRawJobs);
router.get("/matched", requireExtendedViewer, getMatchedJobs);
router.get("/rejected", requireExtendedViewer, getRejectedJobs);
router.get("/grouped", requireExtendedViewer, getGroupedJobs);
router.get("/complete", requireExtendedViewer, getCompleteJobs);
router.get("/report", requireExtendedViewer, getReport);
router.post("/run", requireAdmin, runJobSearch);
router.post("/stop", requireAdmin, stopJobSearch);
router.patch("/:id/status", requireAdmin, updateJobStatus);
router.delete("/raw", requireAdmin, deleteRawJobs);

module.exports = router;
