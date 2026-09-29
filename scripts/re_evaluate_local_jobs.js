require('dotenv').config();
const mongoose = require('mongoose');
const chalk = require('chalk');
require('../models/Company');
const RawJob = require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');
const RejectedJob = require('../models/RejectedJob');
const { getActiveProfile, runEvaluationPipeline } = require('../services/pipeline/aiEvaluationService');
const { saveMatchedJob } = require('../services/pipeline/storageService');

async function reEvaluateLocalJobs() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(chalk.bold.cyan('\n🔍 [Re-Evaluation] Starting Parallel Cloud AI Re-Evaluation of Local Jobs...'));

    const profile = await getActiveProfile();
    const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);

    // 1. Check any local jobs in MatchedJob
    const localMatched = await MatchedJob.find({
        $or: [
            { provider: { $regex: /local/i } },
            { provider: 'unknown' },
            { provider: null },
            { evaluatedBy: { $regex: /local/i } },
            { needsReEvaluation: true }
        ]
    }).populate('rawJob').populate('company');

    console.log(chalk.yellow(`Found ${localMatched.length} local-evaluated jobs in MatchedJob.`));

    // 2. Check jobs in RejectedJob that were evaluated by Local (e.g. because cloud AI previously 429'd)
    const localRejected = await RejectedJob.find({
        $or: [
            { provider: 'local' },
            { evaluatedBy: 'Local' },
            { reason: { $regex: /local scoring/i } }
        ]
    }).populate('rawJob').populate('company');

    console.log(chalk.yellow(`Found ${localRejected.length} jobs in RejectedJob rejected solely by Local Heuristic.\n`));

    const aiState = {
        gemini: { available: true, requests: 0, success: 0, failed: 0 },
        groq: { available: true, requests: 0, success: 0, failed: 0 },
        openrouter: { available: true, requests: 0, success: 0, failed: 0 },
        litellm: { available: false },
        local: { disabled: true },
        calls: 0
    };

    let stats = {
        totalEvaluated: 0,
        promotedToMatched: 0,
        confirmedRejected: 0,
        failed: 0
    };

    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(3); // 3 parallel workers

    let completed = 0;
    const total = localRejected.length;

    await Promise.allSettled(localRejected.map(rej => limit(async () => {
        stats.totalEvaluated++;
        const index = ++completed;
        const progress = `[${index}/${total}]`;

        const jobToEvaluate = {
            title: rej.role,
            location: rej.location,
            company: rej.company?.name || "Unknown Company",
            description: rej.rawJob?.description || rej.reason || rej.role,
            experience: rej.rawJob?.experience || "",
            employmentType: rej.rawJob?.employmentType || "Full-Time",
            applyLink: rej.applyLink || rej.rawJob?.applyLink
        };

        try {
            const result = await runEvaluationPipeline(jobToEvaluate, profile, aiState);

            if (result && result.skipped) {
                // Pre-filter rejected
                stats.confirmedRejected++;
                rej.provider = "pre-filter";
                rej.evaluatedBy = "AI Pre-Filter";
                rej.reason = `Pre-filter: ${result.reason}`;
                rej.verifiedAt = new Date();
                rej.verificationStatus = "rejected";
                await rej.save();
                console.log(chalk.gray(`${progress} ⏩ Pre-filter Rejected: ${jobToEvaluate.title} (${result.reason})`));
            } else if (result && result.analysis) {
                const analysis = result.analysis;
                const newProvider = (analysis.provider || "gemini").toLowerCase();
                const isApproved = analysis.suitable === true && analysis.score >= MATCH_THRESHOLD && !analysis.isClosed;

                if (isApproved) {
                    stats.promotedToMatched++;
                    console.log(chalk.green.bold(`${progress} 🎯 PROMOTED TO MATCHED (Score: ${analysis.score}/100) via ${newProvider.toUpperCase()}: ${jobToEvaluate.title} at ${jobToEvaluate.company}`));

                    // Save to MatchedJob
                    let rawJob = rej.rawJob;
                    if (!rawJob) {
                        rawJob = await RawJob.create({
                            title: jobToEvaluate.title,
                            location: jobToEvaluate.location,
                            applyLink: jobToEvaluate.applyLink,
                            company: rej.company?._id || null,
                            companyName: jobToEvaluate.company,
                            description: jobToEvaluate.description,
                            aiEvaluated: true,
                            aiMatched: true
                        });
                    } else {
                        rawJob.aiEvaluated = true;
                        rawJob.aiMatched = true;
                        await rawJob.save();
                    }

                    await saveMatchedJob(rawJob, rej.company || { _id: null, name: jobToEvaluate.company }, jobToEvaluate, analysis);
                    // Remove from RejectedJob
                    await RejectedJob.findByIdAndDelete(rej._id);
                } else {
                    stats.confirmedRejected++;
                    rej.score = analysis.score;
                    rej.reason = analysis.reason;
                    rej.provider = newProvider;
                    rej.evaluatedBy = analysis.evaluatedBy || "Cloud AI";
                    rej.model = analysis.model;
                    rej.verifiedAt = new Date();
                    rej.verificationStatus = "rejected";
                    await rej.save();
                    console.log(chalk.yellow(`${progress} ❌ Confirmed Rejection (Score: ${analysis.score}/100) via ${newProvider}: ${jobToEvaluate.title} (${analysis.reason?.substring(0, 60)}...)`));
                }
            } else {
                stats.failed++;
                console.log(chalk.red(`${progress} ⚠️ Evaluation failed for: ${jobToEvaluate.title}`));
            }
        } catch (err) {
            stats.failed++;
            console.error(chalk.red(`${progress} Error: ${err.message}`));
        }
    })));

    console.log(chalk.bold.cyan('\n================================================'));
    console.log(chalk.bold.cyan('🏁 [Parallel Re-Evaluation Summary]'));
    console.log(chalk.white(`• Total Local Jobs Re-Evaluated: `) + chalk.yellow.bold(stats.totalEvaluated));
    console.log(chalk.white(`• Promoted to Matched (Approved): `) + chalk.green.bold(stats.promotedToMatched));
    console.log(chalk.white(`• Confirmed Rejected by Cloud AI: `) + chalk.gray(stats.confirmedRejected));
    console.log(chalk.white(`• Failed: `) + chalk.red(stats.failed));
    console.log(chalk.white(`• Gemini Calls: `) + chalk.magenta(`${aiState.gemini.success}/${aiState.gemini.requests}`));
    console.log(chalk.white(`• Groq Calls: `) + chalk.magenta(`${aiState.groq.success}/${aiState.groq.requests}`));
    console.log(chalk.white(`• OpenRouter Calls: `) + chalk.magenta(`${aiState.openrouter.success}/${aiState.openrouter.requests}`));
    console.log(chalk.bold.cyan('================================================\n'));

    await mongoose.connection.close();
}

reEvaluateLocalJobs().catch(console.error);
