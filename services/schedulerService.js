const cron = require('node-cron');
const chalk = require('chalk');
const pipelineState = require('./pipelineState');
const PipelineLock = require('../models/PipelineLock');
const SchedulerLog = require('../models/SchedulerLog');
const { broadcast } = require('./socketService');
const runSearch = require('../cron/jobSearchCron');

let cronTask = null;
const SCHEDULE_EXPRESSION = "0 7 * * *"; // 7:00 AM every day
const TIMEZONE = "Asia/Kolkata";

const init = () => {
    if (cronTask) {
        console.log(chalk.yellow("[Scheduler] Already initialized. Skipping."));
        return;
    }

    console.log(chalk.green(`[Scheduler] Initializing Azure Native Scheduler: ${SCHEDULE_EXPRESSION} (${TIMEZONE})`));

    cronTask = cron.schedule(SCHEDULE_EXPRESSION, async () => {
        console.log(chalk.blue(`[Scheduler] Scheduled trigger activated at ${new Date().toLocaleString('en-US', { timeZone: TIMEZONE })} IST`));
        
        broadcast("scheduler:start", {
            message: "Scheduler triggered the pipeline",
            timestamp: new Date()
        });

        if (pipelineState.running) {
            console.log(chalk.yellow("[Scheduler] Pipeline is already running. Skipping execution."));
            broadcast("scheduler:error", {
                message: "Skipped: Pipeline already running",
                timestamp: new Date()
            });

            await SchedulerLog.create({
                startedAt: new Date(),
                completedAt: new Date(),
                durationMs: 0,
                triggerSource: "Scheduler",
                result: "Skipped",
                error: "Pipeline already running"
            });
            return;
        }

        const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
        if (lock && lock.status === "Running" && lock.expiresAt > new Date()) {
            console.log(chalk.yellow("[Scheduler] PipelineLock is currently held. Skipping execution."));
            broadcast("scheduler:error", {
                message: "Skipped: PipelineLock held by another process",
                timestamp: new Date()
            });

            await SchedulerLog.create({
                startedAt: new Date(),
                completedAt: new Date(),
                durationMs: 0,
                triggerSource: "Scheduler",
                result: "Skipped",
                error: "PipelineLock held"
            });
            return;
        }

        try {
            await runSearch("Scheduler");
            broadcast("scheduler:complete", {
                message: "Scheduled pipeline completed successfully",
                timestamp: new Date()
            });
        } catch (error) {
            console.error(chalk.red(`[Scheduler] Pipeline failed: ${error.message}`));
            broadcast("scheduler:error", {
                message: `Failed: ${error.message}`,
                timestamp: new Date()
            });
        }
        
        const nextStatus = await getSchedulerStatus();
        broadcast("scheduler:next", {
            nextRun: nextStatus.nextScheduledRun,
            timestamp: new Date()
        });

    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
};

const getSchedulerStatus = async () => {
    const lastRun = await SchedulerLog.findOne({ triggerSource: "Scheduler" }).sort({ startedAt: -1 }).lean();
    const lastSuccess = await SchedulerLog.findOne({ triggerSource: "Scheduler", result: "Success" }).sort({ startedAt: -1 }).lean();
    const lastFailed = await SchedulerLog.findOne({ triggerSource: "Scheduler", result: { $in: ["Failed", "Partial Success"] } }).sort({ startedAt: -1 }).lean();

    // node-cron doesn't natively expose the exact next date easily without private variables, 
    // but we can calculate it or simply state it's scheduled.
    // For 7:00 AM IST daily, we can dynamically calculate the next occurrence:
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    });
    
    // Create a date object in IST
    const parts = formatter.formatToParts(now);
    const istParts = {};
    parts.forEach(({ type, value }) => istParts[type] = value);
    
    let nextRunDate = new Date(Date.UTC(
        parseInt(istParts.year),
        parseInt(istParts.month) - 1,
        parseInt(istParts.day),
        7, 0, 0
    ));
    
    // Apply IST offset (-5:30) to get UTC time for 7:00 AM IST
    nextRunDate = new Date(nextRunDate.getTime() - (5.5 * 60 * 60 * 1000));
    
    if (nextRunDate <= now) {
        nextRunDate.setDate(nextRunDate.getDate() + 1);
    }

    // Determine actual status
    let currentStatus = "IDLE";
    if (cronTask) {
        currentStatus = "WAITING";
        const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" }).lean();
        if (lock && lock.status === "Running" && lock.expiresAt > new Date() && lock.runner === "Scheduler") {
            currentStatus = "RUNNING";
        } else if (pipelineState.running && pipelineState.owner === "Scheduler") {
            currentStatus = "RUNNING";
        }
    }

    return {
        status: currentStatus,
        lastScheduledRun: lastRun ? lastRun.startedAt : null,
        nextScheduledRun: nextRunDate,
        lastSuccessfulRun: lastSuccess ? lastSuccess.startedAt : null,
        lastFailedRun: lastFailed ? lastFailed.startedAt : null,
        duration: lastRun ? lastRun.durationMs : 0,
        triggerSource: "Scheduler"
    };
};

const shutdown = () => {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
        console.log(chalk.gray("[Scheduler] Shutdown complete."));
    }
};

module.exports = {
    init,
    getSchedulerStatus,
    shutdown
};
