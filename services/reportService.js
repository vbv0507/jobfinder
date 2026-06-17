const MatchedJob = require("../models/MatchedJob");

const generateReport = async () => {
    const jobs = await MatchedJob
        .find()
        .populate("company", "name")
        .sort({ score: -1 });

    return jobs;
};

// Group jobs by company
const generateGroupedReport = async () => {
    const jobs = await MatchedJob
        .find()
        .populate("company", "name")
        .sort({ score: -1 });

    const grouped = {};
    jobs.forEach(job => {
        const companyName = job.company?.name || "Unknown";
        if (!grouped[companyName]) {
            grouped[companyName] = [];
        }
        grouped[companyName].push(job);
    });

    return grouped;
};

module.exports = {
    generateReport,
    generateGroupedReport
};
