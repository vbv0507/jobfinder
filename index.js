require("dotenv").config();

const express = require("express");

const connectDB = require("./config/db");

const companyRoutes = require("./routes/companyRoutes");
const jobRoutes = require("./routes/jobRoutes");
const profileRoutes = require("./routes/profileRoutes");

const runSearch = require("./cron/jobSearchCron");
const { seedCompanies } = require("./services/companyService");
const { generateMatchedCompanyReport } = require("./services/reportService");

const app = express();

// Middleware
app.use(express.json());
app.use(express.static("public"));

// View Engine Setup
app.set("view engine", "ejs");
app.set("views", "./views");

// Frontend Routes
app.get("/", (req, res) => {
    res.render("index");
});

app.get("/jobs", async (req, res) => {
    try {
        const jobs = await generateMatchedCompanyReport();
        res.render("jobs", { jobs });
    } catch (error) {
        res.render("jobs", { jobs: {} });
    }
});

app.get("/companies", (req, res) => {
    res.render("companies");
});

// API Routes
app.use("/api/companies", companyRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/profile", profileRoutes);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDB();

    if (process.env.SEED_COMPANIES_ON_START !== "false") {
        await seedCompanies();
    }

    if (process.env.RUN_SEARCH_ON_START === "true") {
        await runSearch();
    }

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();
