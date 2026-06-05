require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("../config/db");
const runSearch = require("../cron/jobSearchCron");
const { seedCompanies } = require("../services/companyService");

const runJobSearchOnce = async () => {
    try {
        console.log("GitHub Action job search started");

        await connectDB();

        // Keep MongoDB company list updated before running the scraper.
        await seedCompanies();

        await runSearch();

        console.log("GitHub Action job search completed");
        process.exit(0);
    } catch (error) {
        console.error("GitHub Action job search failed:", error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
};

runJobSearchOnce();
