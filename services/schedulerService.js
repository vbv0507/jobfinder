const cron = require('node-cron');
const chalk = require('chalk');
const pipelineState = require('./pipelineState');
const PipelineLock = require('../models/PipelineLock');
const SchedulerLog = require('../models/SchedulerLog');
const { broadcast } = require('./socketService');
const runSearch = require('../cron/jobSearchCron');

let cronTask = null;
let emailCronTask = null;
const SCHEDULE_EXPRESSION = "0 7 * * *"; // 7:00 AM every day
const EMAIL_SCHEDULE_EXPRESSION = "0 20 * * *"; // 8:00 PM every day
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

    emailCronTask = cron.schedule(EMAIL_SCHEDULE_EXPRESSION, async () => {
        console.log(chalk.blue(`[Scheduler] Email Batch trigger activated at ${new Date().toLocaleString('en-US', { timeZone: TIMEZONE })} IST`));
        try {
            const MatchedJob = require('../models/MatchedJob');
            const { getActiveProfile, runEvaluationPipeline } = require('./pipeline/aiEvaluationService');
            
            // Re-evaluate Local jobs
            const localJobs = await MatchedJob.find({ provider: { $regex: /^local/i }, needsReEvaluation: true }).populate('rawJob').exec();
            
            if (localJobs.length > 0) {
                console.log(chalk.blue(`[Scheduler] Re-evaluating ${localJobs.length} Local matches before digest...`));
                const profile = await getActiveProfile();
                const aiState = { 
                    gemini: { available: true }, 
                    groq: { available: true }, 
                    zai: { available: true },
                    calls: 0
                };
                
                for (const mJob of localJobs) {
                    if (!mJob.rawJob) continue;
                    try {
                        const originalProvider = mJob.provider;
                        const result = await runEvaluationPipeline(mJob.rawJob, profile, aiState);
                        if (result && !result.skipped && result.analysis) {
                            const newProvider = (result.analysis.provider || "gemini").toLowerCase();
                            const logs = result.analysis.attemptLogs || {};
                            
                            console.log(`[Re-Evaluation] Job ID: ${mJob._id}`);
                            console.log(`  Original Provider: ${originalProvider}`);
                            console.log(`  Current Provider:  ${newProvider}`);
                            console.log(`  Gemini result:     ${logs.gemini || 'Skipped'}`);
                            console.log(`  Groq result:       ${logs.groq || 'Skipped'}`);
                            console.log(`  Z.AI result:       ${logs.zai || 'Skipped'}`);
                            console.log(`  Final Provider:    ${newProvider}`);
                            console.log(`  Verify Duration:   ${result.analysis.evaluationTimeMs || 0}ms`);
                            console.log(`  Reason:            ${result.analysis.reason || 'None'}`);

                            if (newProvider !== "local") {
                                mJob.provider = newProvider;
                                mJob.verificationStatus = 'verified';
                                mJob.emailEligible = true;
                                mJob.needsReEvaluation = false;
                                mJob.verifiedAt = new Date();
                                mJob.score = result.analysis.score;
                                mJob.reason = result.analysis.reason;
                            } else {
                                mJob.verificationStatus = 'LOCAL_ONLY';
                                mJob.emailEligible = false;
                                mJob.needsReEvaluation = false;
                            }
                        } else {
                            mJob.verificationStatus = 'LOCAL_ONLY';
                            mJob.emailEligible = false;
                            mJob.needsReEvaluation = false;
                        }
                    } catch (e) {
                        console.error(chalk.red(`[Scheduler] Re-evaluation failed for job ${mJob._id}: ${e.message}`));
                    }
                    await mJob.save();
                }
            }

            const { processBatchEmail } = require('./emailService');
            await processBatchEmail();
        } catch (err) {
            console.error(chalk.red(`[Scheduler] Email Batch failed: ${err.message}`));
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
};

const getSchedulerStatus = async () => {
    // SchedulerLog is the correct source for the scheduler widget.
    // It is written in the finally block of every run with result, durationMs,
    // triggerSource and metrics — purpose-built for this dashboard card.
    // No triggerSource filter: Manual and Scheduler runs both count.
    const lastRun = await SchedulerLog.findOne({ result: { $nin: ["Skipped", "Running"] } })
        .sort({ startedAt: -1 })
        .lean();
    const lastSuccess = await SchedulerLog.findOne({ result: { $in: ["Success", "Partial Success"] } })
        .sort({ completedAt: -1 })
        .lean();
    // "Partial Success" = pipeline completed; only pure "Failed" is a failure.
    const lastFailed = await SchedulerLog.findOne({ result: "Failed" })
        .sort({ startedAt: -1 })
        .lean();

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
        lastSuccessfulRun: lastSuccess ? lastSuccess.completedAt : null,
        lastFailedRun: lastFailed ? lastFailed.startedAt : null,
        duration: lastRun ? lastRun.durationMs : 0,
        jobsFound: lastRun ? (lastRun.metrics?.jobs || 0) : 0,
        matchedJobs: lastRun ? (lastRun.metrics?.matched || 0) : 0,
        triggerSource: lastRun ? (lastRun.triggerSource || "Unknown") : "Unknown"
    };
};

const shutdown = () => {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
        console.log(chalk.gray("[Scheduler] Shutdown complete."));
    }
    if (emailCronTask) {
        emailCronTask.stop();
        emailCronTask = null;
    }
};

module.exports = {
    init,
    getSchedulerStatus,
    shutdown
};
