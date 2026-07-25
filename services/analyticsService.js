const MatchedJob = require("../models/MatchedJob");
const RawJob = require("../models/RawJob");
const Company = require("../models/Company");
const pipelineState = require("./pipelineState");
const SearchLog = require("../models/SearchLog");

const getAnalyticsData = async () => {
    try {
        
        const getISTStartOfDay = () => {
            const now = new Date();
            const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
            const utcMidnight = new Date(Date.UTC(istTime.getUTCFullYear(), istTime.getUTCMonth(), istTime.getUTCDate()));
            return new Date(utcMidnight.getTime() - (5.5 * 60 * 60 * 1000));
        };
        const startOfDay = getISTStartOfDay();
        
        const rawJobsToday = await RawJob.countDocuments({ scrapedAt: { $gte: startOfDay } });
        const rawJobsCount = await RawJob.countDocuments();
        
        const matchedJobsCount = await MatchedJob.countDocuments();
        
        
        const aiEvaluatedCount = await RawJob.countDocuments({ aiEvaluated: true });
        
        const newJobsCount = await MatchedJob.countDocuments({ status: "new" });
        const savedJobsCount = await MatchedJob.countDocuments({ status: "saved" });
        const appliedJobsCount = await MatchedJob.countDocuments({ status: "applied" });
        const rejectedJobsCount = await MatchedJob.countDocuments({ status: "rejected" });

        const companiesMonitored = await Company.countDocuments({ active: true });

        
        const companyDistribution = await MatchedJob.aggregate([
            {
                $lookup: {
                    from: "companies",
                    localField: "company",
                    foreignField: "_id",
                    as: "companyInfo"
                }
            },
            { $unwind: "$companyInfo" },
            { $group: { _id: "$companyInfo.name", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        
        const scoreDistribution = await MatchedJob.aggregate([
            {
                $bucket: {
                    groupBy: "$score",
                    boundaries: [0, 40, 60, 80, 101],
                    default: "Other",
                    output: { count: { $sum: 1 } }
                }
            }
        ]);

        
        const statusDistribution = await MatchedJob.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        
        const evaluationDistribution = await MatchedJob.aggregate([
            { $group: { _id: "$evaluatedBy", count: { $sum: 1 } } }
        ]);
        
        
        const domainDistribution = await MatchedJob.aggregate([
            { $group: { _id: "$jobDomain", count: { $sum: 1 } } },
            { $match: { _id: { $ne: null } } },
            { $sort: { count: -1 } },
            { $limit: 8 }
        ]);

        const aiProviderStats = await MatchedJob.aggregate([
            { $match: { provider: { $exists: true } } },
            { $group: {
                _id: "$provider",
                count: { $sum: 1 },
                avgTime: { $avg: "$evaluationTimeMs" },
                fallbacks: { $sum: { $cond: [{ $gt: ["$fallbackCount", 0] }, 1, 0] } }
            }}
        ]);
        
        let totalAiEvaluations = 0;
        let totalAiTime = 0;
        let totalFallbacks = 0;
        
        aiProviderStats.forEach(stat => {
            totalAiEvaluations += stat.count;
            totalAiTime += (stat.avgTime * stat.count);
            totalFallbacks += stat.fallbacks;
        });
        
        const aiMetrics = {
            geminiUsage: aiProviderStats.find(s => s._id === 'gemini')?.count || 0,
            groqUsage: aiProviderStats.find(s => s._id === 'groq')?.count || 0,
            localUsage: aiProviderStats.find(s => s._id === 'local')?.count || 0,
            averageEvaluationTimeMs: totalAiEvaluations > 0 ? Math.round(totalAiTime / totalAiEvaluations) : 0,
            fallbackPercentage: totalAiEvaluations > 0 ? Math.round((totalFallbacks / totalAiEvaluations) * 100) : 0,
            providerStats: aiProviderStats
        };

        
        const sevenDaysAgo = getISTStartOfDay();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dailyTrend = await SearchLog.aggregate([
            { $match: { createdAt: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    jobsFound: { $sum: "$jobsFound" },
                    jobsMatched: { $sum: "$jobsMatched" },
                    jobsArchived: { $sum: "$jobsArchived" },
                    jobsRefreshed: { $sum: "$jobsRefreshed" }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        
        const globalSearchLogStats = await SearchLog.aggregate([
            {
                $group: {
                    _id: null,
                    totalRuns: { $sum: 1 },
                    successRuns: { $sum: { $cond: [{ $eq: ["$status", "Success"] }, 1, 0] } },
                    failedRuns: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
                    skippedRuns: { $sum: { $cond: [{ $eq: ["$status", "Skipped"] }, 1, 0] } },
                    totalJobsArchived: { $sum: "$jobsArchived" },
                    totalJobsRefreshed: { $sum: "$jobsRefreshed" },
                    totalDuplicatePrevention: { $sum: "$duplicatePreventionCount" },
                    avgEvaluationTime: { $avg: "$averageEvaluationTimeMs" },
                    avgMetadataRefreshTime: { $avg: "$averageMetadataRefreshTimeMs" },
                    avgRuntime: { $avg: "$durationMs" },
                    avgJobsFound: { $avg: "$jobsFound" },
                    avgMatches: { $avg: "$jobsMatched" },
                    totalParserOutdated: { $sum: "$parserOutdated" },
                    totalAtsChanged: { $sum: "$atsChanged" },
                    totalHttpFailed: { $sum: "$httpFailed" },
                    totalBlocked: { $sum: "$blocked" },
                    totalRetriedSuccessfully: { $sum: "$retriedSuccessfully" },
                    totalJobsScraped: { $sum: "$jobsScraped" },
                    totalDuplicates: { $sum: "$duplicates" },
                    totalValidationDrops: { $sum: "$validationDrops" }
                }
            }
        ]);
        const systemMetrics = globalSearchLogStats.length > 0 ? globalSearchLogStats[0] : {};
        
        
        const lastSuccess = await SearchLog.findOne({ status: "Success" }).sort({ createdAt: -1 });

        return {
            stats: {
                companiesMonitored,
                rawJobsCount,
                rawJobsToday,
                aiEvaluatedCount,
                matchedJobsCount,
                newJobsCount,
                savedJobsCount,
                appliedJobsCount,
                rejectedJobsCount,
                totalJobsArchived: systemMetrics.totalJobsArchived || 0,
                totalJobsRefreshed: systemMetrics.totalJobsRefreshed || 0,
                totalDuplicatePrevention: systemMetrics.totalDuplicatePrevention || 0,
                avgEvaluationTimeMs: Math.round(systemMetrics.avgEvaluationTime || 0),
                avgMetadataRefreshTimeMs: Math.round(systemMetrics.avgMetadataRefreshTime || 0),
                avgRuntimeMs: Math.round(systemMetrics.avgRuntime || 0),
                avgJobsFound: Math.round(systemMetrics.avgJobsFound || 0),
                avgMatches: Math.round(systemMetrics.avgMatches || 0),
                successRate: systemMetrics.totalRuns > 0 ? Math.round((systemMetrics.successRuns / systemMetrics.totalRuns) * 100) : 0,
                failureRate: systemMetrics.totalRuns > 0 ? Math.round((systemMetrics.failedRuns / systemMetrics.totalRuns) * 100) : 0,
                skippedRuns: systemMetrics.skippedRuns || 0,
                lastSuccessfulRun: lastSuccess ? lastSuccess.createdAt : null,
                nextScheduledRun: pipelineState.nextRunTime
            },
            metrics: {
                "Actually Scraped": systemMetrics.totalRuns || 0,
                "Cached Companies": systemMetrics.skippedRuns || 0, // Approx
                "Recovered Nodes": systemMetrics.totalRetriedSuccessfully || 0,
                "Raw Jobs": rawJobsCount || 0,
                "Matched Jobs": matchedJobsCount || 0,
                "AI Evaluations": systemMetrics.jobsEvaluated || 0,
                "Parser Failures": systemMetrics.totalParserOutdated || 0,
                "Validation Failures": systemMetrics.totalValidationDrops || 0,
                "ATS Changed": systemMetrics.totalAtsChanged || 0,
                "Cloudflare Blocks": systemMetrics.totalBlocked || 0,
                "Average Runtime": systemMetrics.avgRuntime || 0,
                "Average Company Time": systemMetrics.avgEvaluationTime || 0
            },
            charts: {
                companyDistribution,
                scoreDistribution,
                statusDistribution,
                evaluationDistribution,
                domainDistribution,
                dailyTrend
            },
            aiMetrics
        };
    } catch (error) {
        console.error("Analytics Error:", error);
        throw error;
    }
};

module.exports = {
    getAnalyticsData
};
