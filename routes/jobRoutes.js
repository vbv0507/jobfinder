const express = require("express");

const {
    getRawJobs,
    getMatchedJobs,
    getGroupedJobs,
    getCompleteJobs,
    getSearchLogs,
    getReport,
    runJobSearch,
    updateAppliedStatus,
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
// Applied checkbox isi endpoint ko hit karta hai.
router.patch("/matched/:id/applied", updateAppliedStatus);
router.delete("/raw", deleteRawJobs);

module.exports = router;
