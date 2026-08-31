require('dotenv').config();
const mongoose = require('mongoose');
const chalk = require('chalk');
const MatchedJob = require('../models/MatchedJob');
const RawJob = require('../models/RawJob');
const RejectedJob = require('../models/RejectedJob');
const Company = require('../models/Company');
const { getActiveProfile, runEvaluationPipeline } = require('../services/pipeline/aiEvaluationService');
const { evaluateJob } = require('../services/geminiService');

async function reEvaluateAllLocalJobs() {
    console.log(chalk.bold.cyan("=================================================="));
    console.log(chalk.bold.cyan("   ROLE NOVA: Re-evaluate Local Matches with LLM  "));
    console.log(chalk.bold.cyan("=================================================="));

    await mongoose.connect(process.env.MONGO_URI);
    console.log(chalk.green("Connected to MongoDB."));

    const profile = await getActiveProfile();
    console.log(chalk.blue(`Loaded Candidate Profile for: ${profile.fullName || profile.targetRole || "Default Candidate"}`));
    console.log(chalk.gray(`Skills: ${(profile.skills || []).slice(0, 8).join(', ')}...`));
    console.log(chalk.gray(`Experience: ${profile.yearsOfExperience || 0} years`));

    const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);
    console.log(chalk.yellow(`Match Score Threshold: ${MATCH_THRESHOLD}/100\n`));

    // Find all jobs evaluated locally or with unknown provider
    const localJobs = await MatchedJob.find({
        $or: [
            { provider: { $regex: /local/i } },
            { provider: 'unknown' },
            { provider: { $exists: false } },
            { provider: null },
            { evaluatedBy: { $regex: /local/i } }
        ]
    }).populate('rawJob').populate('company');

    console.log(chalk.bold.yellow(`Found ${localJobs.length} Local/Unverified Matched Jobs to re-evaluate.\n`));

    if (localJobs.length === 0) {
        console.log(chalk.green("No local matches pending re-evaluation. All matched jobs are cloud verified!"));
        await mongoose.connection.close();
        return;
    }

    const aiState = {
        gemini: { available: true, requests: 0, success: 0, failed: 0 },
        groq: { available: true, requests: 0, success: 0, failed: 0 },
        openrouter: { available: true, requests: 0, success: 0, failed: 0 },
        litellm: { available: true, requests: 0, success: 0, failed: 0 },
        local: { disabled: true },
        calls: 0
    };

    let stats = {
        total: localJobs.length,
        processed: 0,
        approved: 0,
        rejected: 0,
        failed: 0,
        scoresUpdated: []
    };

    for (let i = 0; i < localJobs.length; i++) {
        const mJob = localJobs[i];
        stats.processed++;
        const jobNum = `[${stats.processed}/${stats.total}]`;

        // Extract job data from RawJob or fallback to MatchedJob fields
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

        console.log(chalk.cyan(`\n${jobNum} Evaluating: "${jobToEvaluate.title}" at ${jobToEvaluate.company}`));
        console.log(chalk.gray(`   Old Score (Local): ${mJob.score} | Location: ${jobToEvaluate.location}`));

        try {
            // First check skip heuristic or directly evaluate with AI
            const evalResult = await runEvaluationPipeline(jobToEvaluate, profile, aiState);

            let isApproved = false;
            let finalAnalysis = null;
            let rejectionReason = "";

            if (evalResult.skipped) {
                console.log(chalk.yellow(`   ⏭️ Skipped by Pre-Filter Rule: ${evalResult.reason}`));
                isApproved = false;
                rejectionReason = `Pre-filter rejection: ${evalResult.reason}`;
            } else if (evalResult.analysis) {
                finalAnalysis = evalResult.analysis;
                const newScore = finalAnalysis.score;
                const provider = finalAnalysis.provider || finalAnalysis.evaluatedBy || "AI";
                const model = finalAnalysis.model || "default";

                console.log(chalk.bold[newScore >= MATCH_THRESHOLD ? 'green' : 'red'](
                    `   🤖 AI Evaluator: ${provider} (${model}) -> Real Score: ${newScore}/100 (Suitable: ${finalAnalysis.suitable})`
                ));
                console.log(chalk.gray(`   Reason: ${finalAnalysis.reason}`));

                if (finalAnalysis.suitable === true && newScore >= MATCH_THRESHOLD && !finalAnalysis.isClosed) {
                    isApproved = true;
                } else {
                    isApproved = false;
                    rejectionReason = finalAnalysis.reason || `Score ${newScore} below threshold ${MATCH_THRESHOLD}`;
                }
            } else {
                console.log(chalk.red(`   ⚠️ No analysis returned from AI.`));
                stats.failed++;
                continue;
            }

            if (isApproved && finalAnalysis) {
                // UPDATE MatchedJob with real AI scores & analysis
                await MatchedJob.findByIdAndUpdate(mJob._id, {
                    score: finalAnalysis.score,
                    scoringBreakdown: finalAnalysis.scoringBreakdown || {},
                    confidence: finalAnalysis.confidence || "High",
                    suitable: true,
                    reason: finalAnalysis.reason,
                    primaryReasons: finalAnalysis.primaryReasons || [],
                    matchedSkills: finalAnalysis.matchedSkills || [],
                    missingSkills: finalAnalysis.missingSkills || [],
                    strengths: finalAnalysis.strengths || [],
                    weaknesses: finalAnalysis.weaknesses || [],
                    mandatoryRequirements: finalAnalysis.mandatoryRequirements || [],
                    optionalRequirements: finalAnalysis.optionalRequirements || [],
                    domainMismatch: finalAnalysis.domainMismatch || false,
                    domainExplanation: finalAnalysis.domainExplanation || "",
                    experienceMismatch: finalAnalysis.experienceMismatch || false,
                    roleMatch: finalAnalysis.roleMatch || finalAnalysis.recommendationLevel || "Strong",
                    recommendation: finalAnalysis.recommendation || "Consider applying",
                    evaluatedBy: finalAnalysis.evaluatedBy || "Groq",
                    provider: finalAnalysis.provider || "groq",
                    model: finalAnalysis.model || "qwen/qwen3.8-27b",
                    evaluationTimeMs: finalAnalysis.evaluationTimeMs || 0,
                    verifiedAt: new Date(),
                    verificationStatus: "verified",
                    needsReEvaluation: false,
                    emailEligible: true,
                    $push: {
                        evaluationHistory: {
                            provider: finalAnalysis.provider || "groq",
                            model: finalAnalysis.model || "qwen/qwen3.8-27b",
                            score: finalAnalysis.score,
                            evaluatedAt: new Date(),
                            durationMs: finalAnalysis.evaluationTimeMs || 0
                        }
                    }
                });

                stats.approved++;
                stats.scoresUpdated.push({
                    title: jobToEvaluate.title,
                    company: jobToEvaluate.company,
                    oldScore: mJob.score,
                    newScore: finalAnalysis.score,
                    provider: finalAnalysis.provider
                });
                console.log(chalk.green(`   ✅ Updated MatchedJob successfully (Status: Verified, Score: ${finalAnalysis.score})`));
            } else {
                // MOVE TO REJECTED JOB
                const rawJobId = mJob.rawJob?._id || mJob.rawJob;
                const companyId = mJob.company?._id || mJob.company;

                if (rawJobId) {
                    await RejectedJob.findOneAndUpdate(
                        { rawJob: rawJobId },
                        {
                            $set: {
                                rawJob: rawJobId,
                                company: companyId,
                                role: jobToEvaluate.title,
                                location: jobToEvaluate.location,
                                score: finalAnalysis?.score || 30,
                                reason: rejectionReason,
                                primaryReasons: finalAnalysis?.primaryReasons || [rejectionReason],
                                matchedSkills: finalAnalysis?.matchedSkills || [],
                                missingSkills: finalAnalysis?.missingSkills || [],
                                domainMismatch: finalAnalysis?.domainMismatch || false,
                                experienceMismatch: finalAnalysis?.experienceMismatch || false,
                                recommendation: "Reject",
                                applyLink: jobToEvaluate.applyLink,
                                evaluatedBy: finalAnalysis?.evaluatedBy || "AI Pre-Filter",
                                provider: finalAnalysis?.provider || "ai",
                                model: finalAnalysis?.model || "filter",
                                verifiedAt: new Date(),
                                verificationStatus: "rejected"
                            }
                        },
                        { upsert: true }
                    );
                }

                // Remove from MatchedJob so it no longer pollutes verified matches
                await MatchedJob.findByIdAndDelete(mJob._id);
                stats.rejected++;
                console.log(chalk.red(`   ❌ Rejected by AI. Moved to RejectedJobs collection.`));
            }

        } catch (err) {
            stats.failed++;
            console.error(chalk.red(`   💥 Error evaluating job ${mJob._id}: ${err.message}`));
            
            // If rate limit, wait 3 seconds
            if (err.message.includes('429') || err.message.includes('quota')) {
                console.log(chalk.yellow(`   Rate limit encountered. Backing off 4 seconds...`));
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        // Slight breathing room between evaluations to avoid bursts
        if (i < localJobs.length - 1) {
            await new Promise(r => setTimeout(r, 800));
        }
    }

    console.log(chalk.bold.cyan("\n=================================================="));
    console.log(chalk.bold.cyan("               RE-EVALUATION SUMMARY              "));
    console.log(chalk.bold.cyan("=================================================="));
    console.log(`Total Local Jobs Processed: ${chalk.bold(stats.processed)}`);
    console.log(`Approved & Updated by LLM: ${chalk.bold.green(stats.approved)}`);
    console.log(`Rejected & Cleaned by LLM: ${chalk.bold.red(stats.rejected)}`);
    console.log(`Errors / Skipped:          ${chalk.bold.yellow(stats.failed)}`);

    if (stats.scoresUpdated.length > 0) {
        console.log(chalk.bold.green("\nUpdated Verified Matches:"));
        stats.scoresUpdated.forEach(u => {
            console.log(` - [${u.provider}] ${u.title} at ${u.company}: ${u.oldScore} -> ${chalk.bold.green(u.newScore)}`);
        });
    }

    // Clear memory caches so UI immediately displays fresh data
    const CacheManager = require('../services/cacheManager');
    CacheManager.invalidate();

    await mongoose.connection.close();
    console.log(chalk.green("\nRe-evaluation finished successfully. DB connection closed."));
}

reEvaluateAllLocalJobs().catch(e => {
    console.error(chalk.red("Fatal error in reEvaluateAllLocalJobs:"), e);
    process.exit(1);
});
