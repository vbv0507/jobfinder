require('dotenv').config();
const mongoose = require('mongoose');
const chalk = require('chalk');
const RawJob = require('../../models/RawJob');
const Company = require('../../models/Company');
const MatchedJob = require('../../models/MatchedJob');
const RejectedJob = require('../../models/RejectedJob');
const { getActiveProfile, getSkipReason } = require('./aiEvaluationService');
const { evaluateJob } = require('../geminiService');
const { saveMatchedJob } = require('./storageService');
const { saveTrainingSample } = require('../trainingDatasetService');
const { getLifetimeStats } = require('../jobStatsService');

async function runRawQueuePipeline(options = {}) {
    const forceAll = options.forceAll || false;
    const limit = options.limit || 0; // 0 = all
    const shouldManageConnection = mongoose.connection.readyState !== 1;

    if (shouldManageConnection) {
        await mongoose.connect(process.env.MONGO_URI);
    }
    console.log(chalk.bold.cyan('\n🚀 [RoleNova Raw Queue Pipeline] Starting Execution...'));

    const profile = await getActiveProfile();
    console.log(chalk.gray(`👤 Candidate Profile: ${profile.name || 'Vaibhav Rai'} (${profile.preferredRoles?.slice(0, 3).join(', ')}...)`));

    // Query filter
    const query = forceAll ? {} : { aiEvaluated: { $ne: true } };
    let rawJobsQuery = RawJob.find(query).populate('company').sort({ scrapedAt: -1, createdAt: -1 });
    if (limit > 0) {
        rawJobsQuery = rawJobsQuery.limit(limit);
    }
    const rawJobs = await rawJobsQuery.exec();

    console.log(chalk.white(`📋 Total Raw Queue Jobs Selected: `) + chalk.yellow.bold(rawJobs.length));
    if (rawJobs.length === 0) {
        console.log(chalk.green('✓ No pending unevaluated jobs in Raw Queue. All raw jobs are up-to-date!'));
        if (shouldManageConnection) {
            await mongoose.disconnect();
        }
        return;
    }

    const aiState = {
        calls: 0,
        gemini: { requests: 0, success: 0, failed: 0, available: true },
        geminiFallbacks: 0,
        groq: { requests: 0, success: 0, failed: 0, available: true },
        groqFallbacks: 0,
        openrouter: { requests: 0, success: 0, failed: 0, available: true },
        openrouterFallbacks: 0,
        litellm: { requests: 0, success: 0, failed: 0, available: true },
        local: { requests: 0, success: 0, failed: 0, available: true }
    };

    let processedCount = 0;
    let heuristicSkippedCount = 0;
    let aiEvaluatedCount = 0;
    let matchedCount = 0;
    let rejectedCount = 0;

    const startTime = Date.now();

    for (let i = 0; i < rawJobs.length; i++) {
        const rawJob = rawJobs[i];
        processedCount++;
        const progress = `[${i + 1}/${rawJobs.length}]`;

        const company = rawJob.company || { _id: null, name: 'External Job' };
        const jobTitle = rawJob.title || 'Untitled Role';

        // Check Heuristic Pre-filters first
        const skipReason = getSkipReason(rawJob, profile);

        if (skipReason) {
            heuristicSkippedCount++;
            rawJob.aiEvaluated = true;
            rawJob.aiMatched = false;
            rawJob.aiEvaluatedAt = new Date();
            await rawJob.save();

            await RejectedJob.findOneAndUpdate(
                { rawJob: rawJob._id },
                {
                    $set: {
                        rawJob: rawJob._id,
                        company: company._id,
                        role: rawJob.title,
                        location: rawJob.location,
                        score: 0,
                        suitable: false,
                        reason: `Pre-AI Heuristic Filter: ${skipReason}`,
                        primaryReasons: [skipReason],
                        evaluatedBy: "HeuristicFilter",
                        provider: "pre-filter",
                        model: "heuristic",
                        applyLink: rawJob.applyLink,
                        postedAt: rawJob.postedAt || new Date(),
                        lastScrapedAt: new Date(),
                        lastAIEvaluation: new Date(),
                        jobStatus: "Open",
                        isActive: true
                    }
                },
                { upsert: true }
            );

            console.log(chalk.gray(`${progress} ⏩ Skipped (Heuristic): ${company.name} - ${jobTitle} (${skipReason})`));
            continue;
        }

        // Run AI evaluation
        aiEvaluatedCount++;
        try {
            const analysis = await evaluateJob(rawJob, profile, aiState);

            if (analysis) {
                try {
                    await saveTrainingSample(rawJob, company, analysis, `RAW-QUEUE-${Date.now()}`, 'RawQueuePipeline');
                } catch (e) {}

                const { matched } = await saveMatchedJob(rawJob, company, rawJob, analysis);

                if (matched) {
                    matchedCount++;
                    console.log(
                        chalk.green.bold(`${progress} 🎯 MATCHED (Score: ${analysis.score}/100) [${analysis.provider || 'AI'}]: `) +
                        chalk.white(`${company.name} - ${jobTitle} | `) +
                        chalk.cyan(`${rawJob.location || 'India/Remote'}`)
                    );
                } else {
                    rejectedCount++;
                    console.log(
                        chalk.yellow(`${progress} ❌ Rejected (Score: ${analysis.score}/100) [${analysis.provider || 'AI'}]: `) +
                        chalk.gray(`${company.name} - ${jobTitle} (${analysis.reason?.slice(0, 60)}...)`)
                    );
                }
            }
        } catch (err) {
            console.error(chalk.red(`${progress} ⚠️ Evaluation Error for ${company.name} - ${jobTitle}: ${err.message}`));
        }
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(chalk.bold.cyan('\n================================================'));
    console.log(chalk.bold.cyan(`🏁 [RoleNova Raw Queue Pipeline] Finished in ${durationSec}s`));
    console.log(chalk.white(`• Total Processed: `) + chalk.yellow.bold(processedCount));
    console.log(chalk.white(`• Heuristic Filtered: `) + chalk.gray(heuristicSkippedCount));
    console.log(chalk.white(`• Sent to AI Engine: `) + chalk.magenta(aiEvaluatedCount));
    console.log(chalk.white(`• New Matches Saved: `) + chalk.green.bold(matchedCount));
    console.log(chalk.white(`• AI Rejections Saved: `) + chalk.yellow(rejectedCount));
    console.log(chalk.bold.cyan('================================================\n'));

    // Refresh lifetime stats cache
    try {
        const stats = await getLifetimeStats(true);
        console.log(chalk.blue.bold(`📊 Lifetime Database Stats Refreshed: ${stats.totalScrapedLifetime} total evaluated | ${stats.totalMatchedToUser} matched to profile.`));
    } catch (e) {}

    if (shouldManageConnection) {
        await mongoose.disconnect();
    }
}

module.exports = {
    runRawQueuePipeline
};

if (require.main === module) {
    runRawQueuePipeline().catch(console.error);
}
