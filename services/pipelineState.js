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
    }

    transition(stage, message = null) {
        this.currentStage = stage;
        if (message) {
            this.statusText = message;
        }
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
    }

    cancel() {
        this.cancelRequested = true;
        this.statusText = "Cancellation Requested...";
        this.addLog("WARNING", "Cancellation Requested");
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
    }

    addLog(level, message) {
        const timestamp = Date.now();
        this.logs.unshift({ time: timestamp, level, message });
        if (this.logs.length > 500) {
            this.logs.pop(); // Keep last 500 logs
        }
    }

    addTimeline(stage, company, message, status, duration = null) {
        this.timeline.unshift({
            timestamp: Date.now(),
            stage,
            company,
            message,
            status,
            duration
        });
        if (this.timeline.length > 200) {
            this.timeline.pop(); // Keep last 200 timeline entries
        }
    }

    updateElapsed() {
        if (this.running && this.startTime) {
            this.elapsedTime = Date.now() - this.startTime;
        }
    }
}

// Export as a singleton
const pipelineState = new PipelineStateManager();
module.exports = pipelineState;
