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

const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/raw", requireViewer, getRawJobs);
router.get("/matched", requireViewer, getMatchedJobs);
router.get("/rejected", requireViewer, getRejectedJobs);
router.get("/grouped", requireViewer, getGroupedJobs);
router.get("/complete", requireViewer, getCompleteJobs);
router.get("/report", requireViewer, getReport);
router.post("/run", runJobSearch);
router.post("/stop", requireAdmin, stopJobSearch);
router.patch("/:id/status", requireAdmin, updateJobStatus);
router.delete("/raw", requireAdmin, deleteRawJobs);

module.exports = router;
