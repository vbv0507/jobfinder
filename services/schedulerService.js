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

let isVerifyLocalRunning = false;
let shouldStopVerifyLocal = false;

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
            const { runRawQueuePipeline } = require('./pipeline/rawQueueService');
            console.log(chalk.blue(`[Scheduler] Auto-draining pending Raw Queue jobs before daily digest...`));
            await runRawQueuePipeline();

            await verifyLocalJobs();

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

const verifyLocalJobs = async () => {
    if (isVerifyLocalRunning) {
        console.log(chalk.yellow("[Scheduler] Verify Local Jobs is already running. Skipping duplicate request."));
        return { message: "Already running" };
    }
    isVerifyLocalRunning = true;

    try {
        const MatchedJob = require('../models/MatchedJob');
        const RejectedJob = require('../models/RejectedJob');
        const { getActiveProfile, runEvaluationPipeline } = require('./pipeline/aiEvaluationService');
        const { saveMatchedJob } = require('./pipeline/storageService');
        const CacheManager = require('./cacheManager');

        const localJobs = await MatchedJob.find({
            $or: [
                { provider: { $regex: /local/i } },
                { provider: 'unknown' },
                { provider: { $exists: false } },
                { provider: null },
                { evaluatedBy: { $regex: /local/i } }
            ]
        }).populate('rawJob').populate('company').exec();

        let stats = { processed: 0, approved: 0, rejected: 0, failed: 0 };

        if (localJobs.length > 0) {
            console.log(chalk.blue(`[Scheduler] Re-evaluating ${localJobs.length} Local matches with AI LLM...`));
            const profile = await getActiveProfile();
            const aiState = { 
                gemini: { available: true, requests: 0, success: 0, failed: 0 }, 
                groq: { available: true, requests: 0, success: 0, failed: 0 },
                openrouter: { available: true, requests: 0, success: 0, failed: 0 },
                litellm: { available: true, requests: 0, success: 0, failed: 0 },
                local: { disabled: true },
                calls: 0
            };
            
            const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);
            
            let index = 0;
            for (const mJob of localJobs) {
                index++;
                stats.processed++;

                if (shouldStopVerifyLocal) {
                    console.log(chalk.yellow(`[Scheduler] Re-evaluation stopped by user request.`));
                    stats.stopped = true;
                    break;
                }

                const raw = mJob.rawJob;
                const jobToEvaluate = {
                    title: raw?.title || mJob.role,
                    location: raw?.location || mJob.location,
                    company: mJob.company?.name || raw?.companyName || "Unknown Company",
                    description: raw?.description || mJob.reason || mJob.role,
                    experience: raw?.experience || "",
                    employmentType: raw?.employmentType || "Full-Time",
                    applyLink: raw?.applyLink || mJob.applyLink
                };

                try {
                    const result = await runEvaluationPipeline(jobToEvaluate, profile, aiState);

                    if (result && result.skipped) {
                        // Pre-filter rejected
                        stats.rejected++;
                        console.log(`[Re-Evaluation] Job ${mJob._id} REJECTED by Pre-Filter (${result.reason}).`);
                        
                        const rawJobId = mJob.rawJob?._id || mJob.rawJob;
                        if (rawJobId) {
                            await RejectedJob.findOneAndUpdate(
                                { rawJob: rawJobId },
                                {
                                    $set: {
                                        rawJob: rawJobId,
                                        company: mJob.company?._id || mJob.company,
                                        role: jobToEvaluate.title,
                                        location: jobToEvaluate.location,
                                        score: 30,
                                        reason: `Pre-filter rejection: ${result.reason}`,
                                        primaryReasons: [`Pre-filter rejection: ${result.reason}`],
                                        recommendation: "Reject",
                                        applyLink: jobToEvaluate.applyLink,
                                        evaluatedBy: "AI Pre-Filter",
                                        provider: "filter",
                                        verifiedAt: new Date(),
                                        verificationStatus: "rejected"
                                    }
                                },
                                { upsert: true }
                            );
                        }
                        await MatchedJob.findByIdAndDelete(mJob._id);
                    } else if (result && result.analysis) {
                        const newProvider = (result.analysis.provider || "gemini").toLowerCase();
                        const isApproved = result.analysis.suitable === true && result.analysis.score >= MATCH_THRESHOLD && !result.analysis.isClosed;
                        
                        if (isApproved) {
                            stats.approved++;
                            console.log(`[Re-Evaluation] Job ${mJob._id} APPROVED by ${newProvider} (Score: ${result.analysis.score}/100).`);
                            
                            await MatchedJob.findByIdAndUpdate(mJob._id, { 
                                score: result.analysis.score,
                                scoringBreakdown: result.analysis.scoringBreakdown || {},
                                confidence: result.analysis.confidence || "High",
                                suitable: true,
                                reason: result.analysis.reason,
                                primaryReasons: result.analysis.primaryReasons || [],
                                matchedSkills: result.analysis.matchedSkills || [],
                                missingSkills: result.analysis.missingSkills || [],
                                strengths: result.analysis.strengths || [],
                                weaknesses: result.analysis.weaknesses || [],
                                mandatoryRequirements: result.analysis.mandatoryRequirements || [],
                                optionalRequirements: result.analysis.optionalRequirements || [],
                                domainMismatch: result.analysis.domainMismatch || false,
                                domainExplanation: result.analysis.domainExplanation || "",
                                experienceMismatch: result.analysis.experienceMismatch || false,
                                roleMatch: result.analysis.roleMatch || result.analysis.recommendationLevel || "Strong",
                                recommendation: result.analysis.recommendation || "Consider applying",
                                evaluatedBy: result.analysis.evaluatedBy || "Groq",
                                provider: newProvider,
                                model: result.analysis.model || "qwen/qwen3.8-27b",
                                evaluationTimeMs: result.analysis.evaluationTimeMs || 0,
                                emailEligible: true, 
                                needsReEvaluation: false, 
                                verifiedAt: new Date(),
                                verificationStatus: "verified"
                            });
                        } else {
                            stats.rejected++;
                            console.log(`[Re-Evaluation] Job ${mJob._id} REJECTED by ${newProvider} (Score: ${result.analysis.score}/100). Moved to RejectedJobs.`);
                            
                            const rawJobId = mJob.rawJob?._id || mJob.rawJob;
                            if (rawJobId) {
                                await RejectedJob.findOneAndUpdate(
                                    { rawJob: rawJobId },
                                    {
                                        $set: {
                                            rawJob: rawJobId,
                                            company: mJob.company?._id || mJob.company,
                                            role: jobToEvaluate.title,
                                            location: jobToEvaluate.location,
                                            score: result.analysis.score,
                                            reason: result.analysis.reason,
                                            primaryReasons: result.analysis.primaryReasons || [result.analysis.reason],
                                            matchedSkills: result.analysis.matchedSkills || [],
                                            missingSkills: result.analysis.missingSkills || [],
                                            domainMismatch: result.analysis.domainMismatch || false,
                                            experienceMismatch: result.analysis.experienceMismatch || false,
                                            recommendation: "Reject",
                                            applyLink: jobToEvaluate.applyLink,
                                            evaluatedBy: result.analysis.evaluatedBy || "AI",
                                            provider: newProvider,
                                            model: result.analysis.model,
                                            verifiedAt: new Date(),
                                            verificationStatus: "rejected"
                                        }
                                    },
                                    { upsert: true }
                                );
                            }
                            await MatchedJob.findByIdAndDelete(mJob._id);
                        }
                    } else {
                        stats.failed++;
                        console.log(`[Re-Evaluation] Job ${mJob._id} FAILED evaluation.`);
                    }
                } catch (e) {
                    stats.failed++;
                    console.error(chalk.red(`[Scheduler] Re-evaluation failed for job ${mJob._id}: ${e.message}`));
                }
                
                // Batch pause logic (Wait 2 seconds every 5 jobs)
                if (index % 5 === 0 && index < localJobs.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        CacheManager.invalidate();
        return stats;
    } finally {
        isVerifyLocalRunning = false;
        shouldStopVerifyLocal = false;
    }
};

const stopVerifyLocalJobs = () => {
    if (isVerifyLocalRunning) {
        shouldStopVerifyLocal = true;
    }
};

const getVerifyLocalStatus = () => isVerifyLocalRunning;

module.exports = {
    init,
    getSchedulerStatus,
    shutdown,
    verifyLocalJobs,
    getVerifyLocalStatus,
    stopVerifyLocalJobs
};
