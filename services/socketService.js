const { Server } = require("socket.io");
const { verifyToken } = require("@clerk/express");

let io;

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

const serializePipeline = (pipelineState) => ({
    running: pipelineState.running,
    cancelRequested: pipelineState.cancelRequested,
    runId: pipelineState.runId || pipelineState.pipelineId || null,
    pipelineId: pipelineState.pipelineId || pipelineState.runId || null,
    startTime: pipelineState.startTime || (pipelineState.startedAt ? new Date(pipelineState.startedAt).getTime() : null),
    startedAt: pipelineState.startedAt || null,
    endTime: pipelineState.endTime,
    elapsedTime: pipelineState.elapsedTime || 0,
    currentStage: pipelineState.currentStage || "IDLE",
    currentCompany: pipelineState.currentCompany,
    activeCompanies: pipelineState.activeCompanies || [],
    companyIndex: pipelineState.companyIndex || 0,
    totalCompanies: pipelineState.totalCompanies || 0,
    jobsFound: pipelineState.jobsFound || pipelineState.jobsScraped || 0,
    jobsSaved: pipelineState.jobsSaved || 0,
    matchedJobs: pipelineState.matchedJobs || pipelineState.jobsMatched || 0,
    aiEvaluated: pipelineState.aiEvaluated || pipelineState.jobsEvaluated || 0,
    currentATS: pipelineState.currentATS || pipelineState.currentAts,
    currentURL: pipelineState.currentURL,
    currentModel: pipelineState.currentModel,
    currentAiProvider: pipelineState.currentAiProvider,
    retryCount: pipelineState.retryCount || 0,
    parserErrors: pipelineState.parserErrors || 0,
    cloudflareBlocks: pipelineState.cloudflareBlocks || 0,
    cacheHits: pipelineState.cacheHits || 0,
    cacheMisses: pipelineState.cacheMisses || 0,
    progress: pipelineState.progress || "0%",
    statusText: pipelineState.statusText || "Awaiting Execution",
    status: pipelineState.status || pipelineState.currentStage || "Idle",
    logs: pipelineState.logs || [],
    timeline: pipelineState.timeline || [],
    nextRunTime: pipelineState.nextRunTime || null
});

const buildCompanyPayload = async () => {
    const Company = require("../models/Company");
    const { getCompanyLogo } = require("../utils/companyBranding");
    const companies = await Company.find().sort({ name: 1 }).lean();

    return {
        success: true,
        count: companies.length,
        companies: companies.map((company) => ({
            ...company,
            logoUrl: company.logo || getCompanyLogo(company.name)
        }))
    };
};

const buildCachePayload = async (analytics = null) => {
    const Company = require("../models/Company");
    const now = Date.now();
    const companies = await Company.find({ active: true }, "lastScrapedAt").lean();
    const cached = companies.filter((company) =>
        company.lastScrapedAt && (now - new Date(company.lastScrapedAt).getTime()) < TWELVE_HOURS
    ).length;
    const scraped = analytics?.metrics?.["Actually Scraped"] || 0;

    return {
        ttl: "12 Hours",
        totalCompanies: companies.length,
        cachedCompanies: cached,
        expiredCompanies: Math.max(0, companies.length - cached),
        scrapedCompanies: scraped,
        hitRate: companies.length > 0 ? Math.round((cached / companies.length) * 100) : 0,
        cacheSavings: cached * 4500
    };
};

const buildTelegramPayload = async () => {
    const { getListenerStatus } = require("./telegramService");
    const TelegramChannel = require("../models/TelegramChannel");
    const TelegramSyncState = require("../models/TelegramSyncState");
    const listener = getListenerStatus() || {};
    const channels = await TelegramChannel.find({ enabled: true }).sort({ priority: 1, name: 1 }).lean();
    
    let syncStates = [];
    try {
        syncStates = await TelegramSyncState.find().lean();
    } catch (e) {
        console.warn("[Socket] Could not fetch TelegramSyncState");
    }

    const messagesProcessed = channels.reduce((sum, channel) => sum + (channel.messagesProcessed || 0), 0) + 
                              syncStates.reduce((sum, state) => sum + (state.totalMessagesScanned || 0), 0);
    const jobsFound = channels.reduce((sum, channel) => sum + (channel.jobsFound || 0), 0) + 
                      syncStates.reduce((sum, state) => sum + (state.totalJobsExtracted || 0), 0);
    const matchedJobs = channels.reduce((sum, channel) => sum + (channel.matchedJobs || 0), 0) + 
                        syncStates.reduce((sum, state) => sum + (state.totalJobsMatched || 0), 0);
    const deliveryErrors = channels.reduce((sum, channel) => sum + (channel.errorCount || 0), 0) + 
                           syncStates.reduce((sum, state) => sum + (state.totalErrors || 0), 0);

    return {
        connected: !!listener.connected || listener.status === "Connected",
        monitoredChannels: listener.monitoredChannels || channels.map((channel) => channel.username),
        channels,
        syncStates,
        messagesProcessed,
        jobsFound,
        matchedJobs,
        deliveryErrors,
        lastMessageAt: listener.lastJobMessageAt || null
    };
};

const buildDashboardPayload = async (forceRefresh = false) => {
    const { getAnalyticsData } = require("./analyticsService");
    const pipelineState = require("./pipelineState");
    const PipelineLock = require("../models/PipelineLock");

    const [lock, analytics, companies, cache, telegram] = await Promise.all([
        PipelineLock.findOne({ lockId: "global_pipeline_lock" }).lean(),
        getAnalyticsData(forceRefresh),
        buildCompanyPayload(),
        buildCachePayload(),
        buildTelegramPayload()
    ]);

    const pipeline = serializePipeline(pipelineState);
    if (lock && lock.status === "Running" && lock.expiresAt > new Date() && !pipeline.running) {
        pipeline.currentStage = "Running (DB Lock)";
        pipeline.status = "Running";
        pipeline.runner = lock.runner;
        pipeline.lockStartedAt = lock.startedAt;
        pipeline.lockExpiresAt = lock.expiresAt;
    }

    return {
        pipeline,
        metrics: analytics.metrics || {},
        stats: analytics.stats || {},
        charts: analytics.charts || {},
        aiMetrics: analytics.aiMetrics || {},
        analytics,
        companies,
        cache,
        telegram,
        timeline: pipeline.timeline,
        currentCompany: pipeline.currentCompany,
        currentParser: pipeline.currentModel,
        currentATS: pipeline.currentATS,
        activeBrowserCount: pipeline.activeCompanies.length,
        queueSize: Math.max(0, (pipeline.totalCompanies || 0) - (pipeline.companyIndex || 0)),
        jobsFound: pipeline.jobsFound || analytics.metrics?.["Raw Jobs"] || 0,
        jobsSaved: pipeline.jobsSaved || 0,
        aiProvider: pipeline.currentAiProvider || "Gemini / Groq",
        eta: "Calculating...",
        elapsed: pipeline.elapsedTime,
        status: pipeline.currentStage,
        logs: pipeline.logs,
        scheduler: await require("./schedulerService").getSchedulerStatus()
    };
};

const emitInitialState = (socket, initialPayload) => {
    socket.emit("dashboard:init", initialPayload);
    socket.emit("pipeline:init", initialPayload.pipeline);
    socket.emit("logs:init", initialPayload.pipeline.logs || []);
    socket.emit("companies:init", initialPayload.companies.companies || []);
    socket.emit("analytics:init", initialPayload.analytics);
    socket.emit("cache:init", initialPayload.cache);
    socket.emit("telegram:init", initialPayload.telegram);
};

const authenticateSocket = async (socket, next) => {
    try {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error("Unauthorized"));

        const payload = await verifyToken(token, {
            secretKey: process.env.CLERK_SECRET_KEY
        });

        if (!payload || !payload.sub) return next(new Error("Unauthorized"));

        socket.auth = {
            userId: payload.sub,
            sessionId: payload.sid || payload.session_id || null
        };
        return next();
    } catch (error) {
        console.warn("[Socket] Authentication rejected:", error.message);
        return next(new Error("Unauthorized"));
    }
};

const auditSocketAction = async (socket, action, status) => {
    try {
        const { logAuditAction } = require("./auditService");
        await logAuditAction({
            user: { clerkId: socket.auth.userId },
            headers: {},
            socket: { remoteAddress: socket.handshake.address }
        }, action, status);
    } catch (error) {
        console.warn("[Socket] Audit log skipped:", error.message);
    }
};

const init = (server) => {
    if (io) return io;

    io = new Server(server, {
        cors: {
            origin: true,
            credentials: true
        },
        transports: ["websocket", "polling"],
        allowUpgrades: true,
        pingTimeout: Number(process.env.SOCKET_IO_PING_TIMEOUT || 60000),
        pingInterval: Number(process.env.SOCKET_IO_PING_INTERVAL || 25000),
        maxHttpBufferSize: Number(process.env.SOCKET_IO_MAX_HTTP_BUFFER_SIZE || 1e6)
    });

    io.use(authenticateSocket);

    io.on("connection", async (socket) => {
        console.log(`[Socket] Client connected: ${socket.id} (${socket.auth.userId})`);
        const pipelineState = require("./pipelineState");

        try {
            const initialPayload = await buildDashboardPayload();
            emitInitialState(socket, initialPayload);
        } catch (error) {
            console.error("[Socket] Failed to send initial state:", error.message);
        }

        socket.on("dashboard:refresh", async () => {
            const payload = await buildDashboardPayload();
            emitInitialState(socket, payload);
            socket.emit("dashboard:update", payload);
        });

        socket.on("pipeline:start", async (force = false) => {
            const runSearch = require("../cron/jobSearchCron");

            if (pipelineState.running) {
                socket.emit("pipeline:error", "Pipeline is already running.");
                return;
            }

            try {
                await auditSocketAction(socket, "Pipeline Trigger", "Accepted via Socket.IO");
                runSearch("Manual", force).catch((error) => {
                    console.error("Manual pipeline failed", error);
                    broadcast("pipeline:error", error.message);
                });
            } catch (error) {
                socket.emit("pipeline:error", error.message);
            }
        });

        socket.on("pipeline:stop", async () => {
            if (!pipelineState.running) {
                socket.emit("pipeline:error", "Pipeline is not currently running.");
                return;
            }

            await auditSocketAction(socket, "Pipeline Cancel", "Accepted via Socket.IO");
            pipelineState.cancel();
        });

        socket.on("disconnect", (reason) => {
            console.log(`[Socket] Client disconnected: ${socket.id} (${reason})`);
        });
    });

    console.log("[Socket] Service initialized.");
    return io;
};

const getIO = () => {
    if (!io) throw new Error("Socket.IO has not been initialized.");
    return io;
};

const emit = (event, data) => {
    getIO().emit(event, data);
};

const broadcast = (event, data) => {
    if (io) io.emit(event, data);
};


const emitCompanySnapshot = async () => {
    const payload = await buildCompanyPayload();
    broadcast("companies:update", payload);
    return payload;
};

const emitCompany = (company) => {
    broadcast("company:update", company);
};

const emitDashboardSnapshot = async (forceRefresh = false) => {
    const payload = await buildDashboardPayload(forceRefresh);
    broadcast("dashboard:update", payload);
    return payload;
};
const emitDashboard = async () => {
    const payload = await buildDashboardPayload();
    broadcast("dashboard:update", payload);
    return payload;
};

const emitPipeline = (event, data) => {
    broadcast(`pipeline:${event}`, data);
};

const emitAnalytics = (data) => {
    broadcast("analytics:update", data);
};

const emitLogs = (logEntry) => {
    broadcast("logs:new", logEntry);
};

const emitTelegram = (data) => {
    broadcast("telegram:update", data);
};

const emitTelegramSync = (event, data) => {
    broadcast(event, data);
};

const emitCache = (data) => {
    broadcast("cache:update", data);
};

const emitATS = (data) => {
    broadcast("ats:update", data);
};

module.exports = {
    init,
    getIO,
    emit,
    broadcast,
    emitToAll: broadcast,
    emitDashboard,
    emitPipeline,
    emitAnalytics,
    emitCompany,
    emitCompanySnapshot,
    emitLogs,
    emitTelegram,
    emitTelegramSync,
    emitCache,
    emitATS,
    emitDashboardSnapshot,
    buildDashboardPayload,
    buildCompanyPayload,
    buildCachePayload,
    get io() { return io; }
};
