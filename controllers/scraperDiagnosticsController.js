const Company = require("../models/Company");
const SearchLog = require("../models/SearchLog");

const sendError = (res, error) => res.status(500).json({ error: error.message });

const getCompanies = async (req, res) => {
    try {
        const companies = await Company.find({}, "name careerUrl scraperConfig healthScore successPercent runHistory")
            .sort({ healthScore: 1 });
        res.json(companies);
    } catch (error) {
        sendError(res, error);
    }
};

const exportJson = async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(10);
        res.json(logs);
    } catch (error) {
        sendError(res, error);
    }
};

const exportCsv = async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(10);
        if (!logs.length) return res.send("No data");

        const columns = [
            "createdAt", "companiesScanned", "companiesWithJobs", "companiesWithoutJobs",
            "parserOutdated", "atsChanged", "httpFailed", "jobsScraped", "jobsFound",
            "validationDrops", "duplicates", "jobsSaved",
        ];
        const rows = logs.map((log) => columns.map((column) => log[column]).join(","));

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=\"diagnostics.csv\"");
        res.send([columns.join(","), ...rows].join("\n"));
    } catch (error) {
        sendError(res, error);
    }
};

const getChartData = async (req, res) => {
    try {
        const companies = await Company.find({}, "name healthScore failureReason runHistory");
        const logs = await SearchLog.find().sort({ createdAt: 1 }).limit(30);
        const healthDistribution = { Healthy: 0, Good: 0, Warning: 0, Critical: 0, Broken: 0 };

        companies.forEach((company) => {
            if (company.healthScore >= 90) healthDistribution.Healthy += 1;
            else if (company.healthScore >= 70) healthDistribution.Good += 1;
            else if (company.healthScore >= 50) healthDistribution.Warning += 1;
            else if (company.healthScore >= 30) healthDistribution.Critical += 1;
            else healthDistribution.Broken += 1;
        });

        const failingCompanies = companies
            .filter((company) => company.healthScore < 50)
            .sort((first, second) => first.healthScore - second.healthScore)
            .slice(0, 10);
        const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

        res.json({
            healthDistribution,
            logs,
            failingCompanies,
            validationDropsByReason: latestLog ? (latestLog.validationDropsByReason || {}) : {},
        });
    } catch (error) {
        sendError(res, error);
    }
};

module.exports = { getCompanies, exportJson, exportCsv, getChartData };
