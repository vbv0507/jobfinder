const MatchedJob = require("../models/MatchedJob");
const RawJob = require("../models/RawJob");
const Company = require("../models/Company");

const getHostname = (value = "") => {
    try {
        return new URL(value).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
};

const inferCompanyName = (job, companies) => {
    if (job.company?.name) {
        return job.company.name;
    }

    const text = [
        job.applyLink,
        job.title,
        job.role,
        job.location,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    const matchedCompany = companies.find((company) => {
        const name = company.name.toLowerCase();
        const hostname = getHostname(company.careerUrl?.toLowerCase());

        return (
            text.includes(name) ||
            (name === "lg" && (text.includes("lge.com") || text.includes("lg electronics"))) ||
            (name === "visa" && text.includes("visa.wd")) ||
            (name === "adobe" && text.includes("adobe.wd")) ||
            (hostname && text.includes(hostname))
        );
    });

    return matchedCompany?.name || "Unassigned";
};

const createCompanyBucket = () => ({ matched: [], raw: [] });
const createMatchedBucket = () => ({ matched: [], applied: [] });

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

// Group only matched jobs by company for frontend display.
const generateMatchedCompanyReport = async () => {
    const companies = await Company.find().sort({ name: 1 });
    const matchedJobs = await MatchedJob
        .find()
        .populate("company", "name")
        .populate("rawJob", "postedAt scrapedAt")
        .sort({ score: -1 });

    const grouped = {};

    matchedJobs.forEach(job => {
        const companyName = inferCompanyName(job, companies);
        if (!grouped[companyName]) {
            grouped[companyName] = createMatchedBucket();
        }

        if (job.applied) {
            grouped[companyName].applied.push(job);
            return;
        }

        grouped[companyName].matched.push(job);
    });

    return grouped;
};

// Group both matched AND raw jobs by company
const generateCompleteReport = async () => {
    const companies = await Company.find().sort({ name: 1 });

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
    const matchedRawJobIds = new Set(
        matchedJobs
            .map(job => job.rawJob?.toString())
            .filter(Boolean)
    );

    // Group by company with separate matched/raw sections
    const grouped = {};

    matchedJobs.forEach(job => {
        const companyName = inferCompanyName(job, companies);
        if (!grouped[companyName]) {
            grouped[companyName] = createCompanyBucket();
        }
        grouped[companyName].matched.push(job);
    });

    rawJobs.forEach(job => {
        if (matchedRawJobIds.has(job._id.toString())) {
            return;
        }

        const companyName = inferCompanyName(job, companies);
        if (!grouped[companyName]) {
            grouped[companyName] = createCompanyBucket();
        }
        grouped[companyName].raw.push(job);
    });

    return grouped;
};

module.exports = {
    generateReport,
    generateGroupedReport,
    generateMatchedCompanyReport,
    generateCompleteReport
};
