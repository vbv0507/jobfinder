const { Server } = require("socket.io");
const { getAnalyticsData } = require("./analyticsService");

let io;

const init = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", async (socket) => {
        console.log(`[Socket] Client connected: ${socket.id}`);

        // Lazy load pipelineState to avoid circular dependencies during initialization
        const pipelineState = require("./pipelineState");
        const PipelineLock = require("../models/PipelineLock");
        const { logAuditAction } = require("./auditService");

        // --- Handle Initial Connection (dashboard:init) ---
        try {
            const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
            const data = await getAnalyticsData();

            let mergedState = { ...pipelineState };
            if (lock && lock.status === "Running" && lock.expiresAt > new Date()) {
                if (!mergedState.running) {
                    mergedState.currentStage = "Running (DB Lock)";
                    mergedState.runner = lock.runner;
                    mergedState.lockStartedAt = lock.startedAt;
                    mergedState.lockExpiresAt = lock.expiresAt;
                }
            }

            const initialPayload = {
                pipeline: mergedState,
                metrics: data.metrics || {},
                timeline: mergedState.timeline,
                currentCompany: mergedState.currentCompany,
                currentParser: mergedState.currentModel,
                currentATS: mergedState.currentATS,
                activeBrowserCount: mergedState.activeCompanies ? mergedState.activeCompanies.length : 0,
                queueSize: mergedState.totalCompanies - (mergedState.companyIndex || 0),
                jobsFound: mergedState.jobsFound || data.metrics?.["Raw Jobs"] || 0,
                jobsSaved: mergedState.jobsSaved || 0,
                aiProvider: "Gemini / Groq",
                eta: "Calculating...",
                elapsed: mergedState.elapsedTime,
                status: mergedState.currentStage,
                logs: mergedState.logs
            };
            
            socket.emit("dashboard:init", initialPayload);
        } catch (error) {
            console.error("[Socket] Failed to send initial dashboard data:", error.message);
        }

        // --- Handle Frontend Commands ---
        socket.on("dashboard:refresh", async () => {
             const data = await getAnalyticsData();
             socket.emit("dashboard:update", { metrics: data.metrics });
        });

        socket.on("pipeline:start", async (force = false) => {
             const runSearch = require("../cron/jobSearchCron");
             
             if (pipelineState.running) {
                 socket.emit("pipeline:error", "Pipeline is already running.");
                 return;
             }
             
             try {
                // Mock request for audit log compatibility if needed, or pass null
                runSearch("Manual", force).catch(e => console.error("Manual pipeline failed", e));
             } catch (e) {
                 socket.emit("pipeline:error", e.message);
             }
        });

        socket.on("pipeline:stop", () => {
             if (pipelineState.running) {
                 pipelineState.cancel();
             } else {
                 socket.emit("pipeline:error", "Pipeline is not currently running.");
             }
        });

        socket.on("disconnect", () => {
            console.log(`[Socket] Client disconnected: ${socket.id}`);
        });
    });

    console.log("[Socket] Service initialized.");
};

const broadcast = (event, data) => {
    if (io) {
        io.emit(event, data);
    }
};

module.exports = {
    init,
    broadcast,
    get io() { return io; }
};
