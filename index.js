require("./utils/logger"); // Initialize structured logging globally
require("dotenv").config();

const express = require("express");

const connectDB = require("./config/db");

const companyRoutes = require("./routes/companyRoutes");
const jobRoutes = require("./routes/jobRoutes");
const profileRoutes = require("./routes/profileRoutes");
const telegramRoutes = require("./routes/telegramRoutes");
const systemRoutes = require("./routes/systemRoutes");
const adminRoutes = require("./routes/adminRoutes");
const MatchedJob = require("./models/MatchedJob");

const runSearch = require("./cron/jobSearchCron");
const { seedCompanies } = require("./services/companyService");
const { generateMatchedCompanyReport } = require("./services/reportService");
const { startTelegramListener, stopTelegramListener } = require("./services/telegramService");
const mongoose = require("mongoose");
const { validateConfig } = require("./utils/configValidator");

const app = express();

const companyBranding = require("./utils/companyBranding");
Object.assign(app.locals, companyBranding);

app.use(express.json());
app.use(express.static("public"));

app.set("view engine", "ejs");
app.set("views", "./views");


app.get("/", (req, res) => {
    res.render("index");
});

app.get("/jobs", async (req, res) => {
    try {
        const jobs = await MatchedJob.find({ status: "new" }).populate("company", "name").sort({ score: -1 });
        res.render("jobs", { jobs, title: "Matched Jobs" });
    } catch (error) {
        res.render("jobs", { jobs: [], title: "Matched Jobs" });
    }
});

app.get("/saved", async (req, res) => {
    try {
        const jobs = await MatchedJob.find({ status: "saved" }).populate("company", "name").sort({ score: -1 });
        res.render("jobs", { jobs, title: "Saved Jobs" });
    } catch (error) {
        res.render("jobs", { jobs: [], title: "Saved Jobs" });
    }
});

app.get("/applied", async (req, res) => {
    try {
        const jobs = await MatchedJob.find({ status: "applied" }).populate("company", "name").sort({ appliedAt: -1 });
        res.render("jobs", { jobs, title: "Applied Jobs" });
    } catch (error) {
        res.render("jobs", { jobs: [], title: "Applied Jobs" });
    }
});

app.get("/rejected", async (req, res) => {
    try {
        const jobs = await MatchedJob.find({ status: "rejected" }).populate("company", "name").sort({ updatedAt: -1 });
        res.render("jobs", { jobs, title: "Rejected Jobs" });
    } catch (error) {
        res.render("jobs", { jobs: [], title: "Rejected Jobs" });
    }
});

app.get("/telegram", (req, res) => {
    res.render("telegram-channels", { title: "Telegram Channels" });
});

app.get("/telegram-monitoring", (req, res) => {
    res.render("telegram-monitoring", { title: "Telegram Monitoring" });
});

app.get("/job/:id", async (req, res) => {
    try {
        const job = await MatchedJob.findById(req.params.id).populate("company", "name");
        res.render("job-details", { job });
    } catch (error) {
        res.redirect("/jobs");
    }
});

app.get("/companies", (req, res) => {
    res.render("companies");
});

app.get("/analytics", (req, res) => {
    res.render("analytics");
});

app.get("/profile", (req, res) => {
    res.render("profile");
});


app.use("/api/companies", companyRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/system", systemRoutes);
app.use("/admin", adminRoutes);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    validateConfig();

    await connectDB();

    if (process.env.SEED_COMPANIES_ON_START !== "false") {
        await seedCompanies();
    }

    if (process.env.RUN_SEARCH_ON_START === "true") {
        await runSearch();
    }

    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    
    await startTelegramListener();

    const shutdown = async (signal) => {
        console.log(`\n[Shutdown] Received ${signal}. Shutting down gracefully...`);
        server.close(console.log('[Shutdown] Express server closed.'));
        if (stopTelegramListener) stopTelegramListener();
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            console.log('[Shutdown] MongoDB connection closed.');
        }
        console.log('[Shutdown] Graceful shutdown complete.');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
};
startServer();
