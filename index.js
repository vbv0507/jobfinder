require("./utils/logger"); // Initialize structured logging globally
require("dotenv").config();

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("./middleware/mongoSanitize");
const { clerkMiddleware, requireAuth } = require("./middleware/authMiddleware");
const connectDB = require("./config/db");
const path = require("path");

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
const socketService = require("./services/socketService");

const app = express();
app.set("trust proxy", 1);

const companyBranding = require("./utils/companyBranding");
Object.assign(app.locals, companyBranding);

app.use(helmet({
    contentSecurityPolicy: false // Disabled to allow Tailwind CDN, Clerk JS, and inline scripts
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.static("public"));

// Request Logging Middleware
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

app.use(mongoSanitize());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    validate: false, // Disable strict validation to prevent throws (especially for custom key generators on IPv6)
    keyGenerator: (req, res) => {
        let ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        if (typeof ip === 'string') {
            ip = ip.split(',')[0].trim();
            // If IPv4 with port (e.g. 103.228.147.81:43833)
            if (ip.includes(':') && ip.split(':').length === 2) {
                return ip.split(':')[0];
            }
        }
        return ip;
    }
});
// Skip rate limiting for system telemetry (polling)
app.use("/api", (req, res, next) => {
    if (req.path.startsWith('/system/live-')) return next();
    return apiLimiter(req, res, next);
});

app.use(clerkMiddleware);

// Inject publishable key into all views
app.use((req, res, next) => {
    res.locals.CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
    next();
});

app.set("view engine", "ejs");
app.set("views", "./views");

app.get("/login", (req, res) => {
    if (req.auth && req.auth.userId) return res.redirect("/");
    res.render("login", { title: "Login" });
});

app.use("/api/companies", companyRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/system", systemRoutes);
app.use("/admin", adminRoutes);

// Health Check Route — no auth required
app.get("/health", (req, res) => {
    const mongoose = require("mongoose");
    const dbState = ["disconnected", "connected", "connecting", "disconnecting"];
    const uptime = process.uptime();
    const mem = process.memoryUsage();

    const status = mongoose.connection.readyState === 1 ? "ok" : "degraded";

    res.status(status === "ok" ? 200 : 503).json({
        status,
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        db: dbState[mongoose.connection.readyState] || "unknown",
        memory: {
            heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
            rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        },
        version: process.env.npm_package_version || "1.0.0",
        node: process.version,
    });
});


// New Frontend Routes
const frontendRoutes = require("./routes/frontendRoutes");
app.use("/", frontendRoutes);

// Error Handler
app.use((err, req, res, next) => {
    console.error("EXPRESS ERROR CAUGHT:", err);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: err ? err.toString() : 'Unknown Error' });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    validateConfig();

    await connectDB();

    if (process.env.SEED_COMPANIES_ON_START !== "false") {
        await seedCompanies();
    }

    // --- PIPELINE LOCK RECOVERY ---
    // If the server was forcefully restarted while a pipeline was running,
    // the global lock might be permanently stuck. We forcefully clear it on boot.
    try {
        const PipelineLock = require('./models/PipelineLock');
        const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
        if (lock && lock.status === "Running") {
            console.log("[Recovery] Found stale pipeline lock on startup. Forcing release...");
            await PipelineLock.updateOne(
                { lockId: "global_pipeline_lock" },
                { $set: { status: "Idle", runner: "none", expiresAt: null } }
            );
        }
    } catch (e) {
        console.error("[Recovery] Failed to recover pipeline lock:", e.message);
    }

    if (process.env.RUN_SEARCH_ON_START === "true") {
        // Run asynchronously without awaiting to avoid blocking server boot
        runSearch("Startup").catch(e => console.error("Startup search failed:", e));
    }

    const server = http.createServer(app);
    socketService.init(server);
    require('./services/schedulerService').init();

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT} (0.0.0.0)`);
    });

    
    await startTelegramListener();

    const shutdown = async (signal) => {
        console.log(`\n[Shutdown] Received ${signal}. Shutting down gracefully...`);
        
        const pipelineState = require('./services/pipelineState');
        if (pipelineState.running) {
            console.log('[Shutdown] Cancelling active pipeline...');
            pipelineState.cancel();
        }
        
        require('./services/schedulerService').shutdown();

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
