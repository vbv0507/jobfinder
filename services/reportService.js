const MatchedJob = require("../models/MatchedJob");
const RawJob = require("../models/RawJob");

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

// Group both matched AND raw jobs by company
const generateCompleteReport = async () => {
    // Get matched jobs
    const matchedJobs = await MatchedJob
        .find()
        .populate("company", "name")
        .sort({ score: -1 });

    // Get raw jobs with company info
    const rawJobs = await RawJob
        .find()
        .populate("company", "name")
        .sort({ scrapedAt: -1 });

    // Get matched job IDs to filter out
    const matchedJobIds = new Set(matchedJobs.map(j => j._id.toString()));

    // Group by company with separate matched/raw sections
    const grouped = {};

    matchedJobs.forEach(job => {
        const companyName = job.company?.name || "Unknown";
        if (!grouped[companyName]) {
            grouped[companyName] = { matched: [], raw: [] };
        }
        grouped[companyName].matched.push(job);
    });

    rawJobs.forEach(job => {
        const companyName = job.company?.name || "Unknown";
        if (!grouped[companyName]) {
            grouped[companyName] = { matched: [], raw: [] };
        }
        // Only add raw jobs that are NOT already in matched
        grouped[companyName].raw.push(job);
    });

    return grouped;
};

module.exports = {
    generateReport,
    generateGroupedReport,
    generateCompleteReport
};
