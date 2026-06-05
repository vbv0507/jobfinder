const MatchedJob = require("../models/MatchedJob");

const generateReport = async () => {
    // The dashboard should show the best matches first.
    const jobs = await MatchedJob
        .find()
        .sort({ score: -1 });

    return jobs;
};

module.exports = {
    generateReport
};
