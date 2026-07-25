const socketService = require("./socketService");

class PipelineStateManager {
    constructor() {
        this.reset();
    }

    reset() {
        this.running = false;
        this.cancelRequested = false;
        this.runId = null;
        this.startTime = null;
        this.endTime = null;
        this.elapsedTime = 0;
        this.currentStage = "IDLE"; 
        this.currentCompany = null;
        this.activeCompanies = [];
        this.companyIndex = 0;
        this.totalCompanies = 0;
        this.jobsFound = 0;
        this.jobsSaved = 0;
        this.matchedJobs = 0;
        this.aiEvaluated = 0;
        this.successfulCompanies = 0;
        this.failedCompanies = 0;
        this.cachedCompanies = 0;
        this.currentATS = null;
        this.currentURL = null;
        this.currentModel = null;
        this.retryCount = 0;
        this.parserErrors = 0;
        this.cloudflareBlocks = 0;
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.progress = "0%";
        this.statusText = "Awaiting Execution";
        this.logs = [];
        this.timeline = [];
    }

    start(runId) {
        this.reset();
        this.running = true;
        this.runId = runId;
        this.startTime = Date.now();
        this.currentStage = "STARTING";
        this.statusText = "Pipeline Started";
        this.addLog("INFO", "Pipeline Started");
        socketService.emitPipeline("started", this.snapshot());
        socketService.emitPipeline("progress", this.progressPayload());
        this.emitUpdate();
    }

    transition(stage, message = null) {
        this.currentStage = stage;
        if (message) {
            this.statusText = message;
        }
        this.emitUpdate();
    }

    finish() {
        if (!this.running) return;
        this.running = false;
        this.endTime = Date.now();
        if (this.startTime) {
            this.elapsedTime = this.endTime - this.startTime;
        }
        this.currentStage = "FINISHED";
        this.statusText = "Pipeline Finished";
        this.progress = "100%";
        this.addLog("SUCCESS", "Pipeline Finished");
        socketService.emitPipeline("finished", this.snapshot());
        socketService.emitDashboardSnapshot(true).catch(error => console.error("[Socket] Failed to refresh dashboard after finish:", error.message));
    }

    fail(errorMsg) {
        if (!this.running) return;
        this.running = false;
        this.endTime = Date.now();
        if (this.startTime) {
            this.elapsedTime = this.endTime - this.startTime;
        }
        this.currentStage = "FAILED";
        this.statusText = `Failed: ${errorMsg}`;
        this.addLog("ERROR", `Pipeline Failed: ${errorMsg}`);
        socketService.emitPipeline("error", { message: errorMsg, pipeline: this.snapshot() });
        this.emitUpdate();
        setTimeout(() => {
            socketService.emitDashboardSnapshot().catch(error => console.error("[Socket] Failed to refresh dashboard after failure:", error.message));
        }, 1500);
    }

    cancel() {
        this.cancelRequested = true;
        this.statusText = "Cancellation Requested...";
        this.addLog("WARNING", "Cancellation Requested");
        socketService.emitPipeline("stopped", this.snapshot());
        this.emitUpdate();
    }

    markCancelled() {
        if (!this.running) return;
        this.running = false;
        this.endTime = Date.now();
        if (this.startTime) {
            this.elapsedTime = this.endTime - this.startTime;
        }
        this.currentStage = "CANCELLED";
        this.statusText = "Pipeline Cancelled";
        this.addLog("WARNING", "Pipeline Cancelled");
        socketService.emitPipeline("stopped", this.snapshot());
        this.emitUpdate();
        setTimeout(() => {
            socketService.emitDashboardSnapshot().catch(error => console.error("[Socket] Failed to refresh dashboard after cancel:", error.message));
        }, 1500);
    }

    addLog(level, message) {
        const timestamp = Date.now();
        const logEntry = { time: timestamp, level, message };
        this.logs.unshift(logEntry);
        if (this.logs.length > 500) {
            this.logs.pop(); // Keep last 500 logs
        }
        socketService.emitLogs(logEntry);
    }

    addTimeline(stage, company, message, status, duration = null) {
        const entry = {
            timestamp: Date.now(),
            stage,
            company,
            message,
            status,
            duration
        };
        this.timeline.unshift(entry);
        if (this.timeline.length > 200) {
            this.timeline.pop(); // Keep last 200 timeline entries
        }
        socketService.emitPipeline("progress", this.progressPayload(entry));
        this.emitUpdate(); // also push the full state update for the UI counts if needed
    }

    updateElapsed() {
        if (this.running && this.startTime) {
            this.elapsedTime = Date.now() - this.startTime;
        }
    }

    snapshot() {
        return {
            running: this.running,
            cancelRequested: this.cancelRequested,
            runId: this.runId,
            startTime: this.startTime,
            endTime: this.endTime,
            elapsedTime: this.elapsedTime,
            currentStage: this.currentStage,
            currentCompany: this.currentCompany,
            activeCompanies: this.activeCompanies,
            companyIndex: this.companyIndex,
            totalCompanies: this.totalCompanies,
            jobsFound: this.jobsFound || this.jobsScraped || 0,
            jobsSaved: this.jobsSaved,
            matchedJobs: this.matchedJobs || this.jobsMatched || 0,
            aiEvaluated: this.aiEvaluated || this.jobsEvaluated || 0,
            successfulCompanies: this.successfulCompanies,
            failedCompanies: this.failedCompanies,
            cachedCompanies: this.cachedCompanies,
            currentATS: this.currentATS,
            currentURL: this.currentURL,
            currentModel: this.currentModel,
            retryCount: this.retryCount,
            parserErrors: this.parserErrors,
            cloudflareBlocks: this.cloudflareBlocks,
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses,
            progress: this.progress,
            statusText: this.statusText,
            logs: this.logs,
            timeline: this.timeline,
            nextRunTime: this.nextRunTime
        };
    }

    progressPayload(entry = {}) {
        const remainingCompanies = Math.max(0, (this.totalCompanies || 0) - (this.companyIndex || 0));
        const remainingEstimate = this.companyIndex > 0
            ? Math.round((this.elapsedTime / this.companyIndex) * remainingCompanies)
            : null;

        return {
            ...entry,
            runId: this.runId,
            companyIndex: this.companyIndex || 0,
            totalCompanies: this.totalCompanies || 0,
            companyName: this.currentCompany || entry.company || null,
            stage: entry.stage || this.currentStage,
            retryCount: this.retryCount || 0,
            jobsFound: this.jobsFound || this.jobsScraped || 0,
            matchedJobs: this.matchedJobs || this.jobsMatched || 0,
            elapsedTime: this.elapsedTime || 0,
            remainingEstimate,
            pipeline: this.snapshot()
        };
    }
    
    emitUpdate() {
        socketService.emitPipeline("update", {
            pipeline: this.snapshot(),
            activeBrowserCount: this.activeCompanies ? this.activeCompanies.length : 0,
            queueSize: this.totalCompanies - (this.companyIndex || 0),
            jobsFound: this.jobsFound || this.jobsScraped || 0,
            jobsSaved: this.jobsSaved || 0,
            elapsed: this.elapsedTime || 0,
            status: this.currentStage || "IDLE",
            currentCompany: this.currentCompany,
            currentATS: this.currentATS,
            currentParser: this.currentModel
        });
    }
}

// Export as a singleton
const pipelineState = new PipelineStateManager();
module.exports = pipelineState;
