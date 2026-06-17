const express = require("express");

const {
    getRawJobs,
    getMatchedJobs,
    getGroupedJobs,
    getCompleteJobs,
    getSearchLogs,
    getReport,
    runJobSearch,
    deleteRawJobs,
} = require("../controller/jobController");

const router = express.Router();

router.get("/raw", getRawJobs);
router.get("/matched", getMatchedJobs);
router.get("/grouped", getGroupedJobs);
router.get("/complete", getCompleteJobs);
router.get("/logs", getSearchLogs);
router.get("/report", getReport);
router.post("/run", runJobSearch);
router.delete("/raw", deleteRawJobs);

module.exports = router;
