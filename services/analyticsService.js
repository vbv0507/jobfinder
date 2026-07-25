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
        
        const rawJobsToday = await RawJob.countDocuments({ scrapedAt: { $gte: startOfDay } }).read('primary');
        const rawJobsCount = await RawJob.countDocuments().read('primary');
        
        const matchedJobsCount = await MatchedJob.countDocuments().read('primary');
        
        
        const aiEvaluatedCount = await MatchedJob.countDocuments({ score: { $exists: true } }).read('primary');
        
        const newJobsCount = await MatchedJob.countDocuments({ status: "new" }).read('primary');
        const savedJobsCount = await MatchedJob.countDocuments({ status: "saved" }).read('primary');
        const appliedJobsCount = await MatchedJob.countDocuments({ status: "applied" }).read('primary');
        const rejectedJobsCount = await MatchedJob.countDocuments({ status: "rejected" }).read('primary');

        const companiesMonitored = await Company.countDocuments({ active: true }).read('primary');

        
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
        ]).read('primary');

        
        const scoreDistribution = await MatchedJob.aggregate([
            {
                $bucket: {
                    groupBy: "$score",
                    boundaries: [0, 40, 60, 80, 101],
                    default: "Other",
                    output: { count: { $sum: 1 } }
                }
            }
        ]).read('primary');

        
        const statusDistribution = await MatchedJob.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]).read('primary');

        
        const evaluationDistribution = await MatchedJob.aggregate([
            { $group: { _id: "$evaluatedBy", count: { $sum: 1 } } }
        ]).read('primary');
        
        
        const domainDistribution = await MatchedJob.aggregate([
            { $group: { _id: "$jobDomain", count: { $sum: 1 } } },
            { $match: { _id: { $ne: null } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]).read('primary');

        const aiProviderStats = await MatchedJob.aggregate([
            { $match: { provider: { $exists: true } } },
            { $group: {
                _id: "$provider",
                count: { $sum: 1 },
                avgTime: { $avg: "$evaluationTimeMs" },
                fallbacks: { $sum: { $cond: [{ $gt: ["$fallbackCount", 0] }, 1, 0] } }
            }}
        ]).read('primary');
        
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
        ]).read('primary');
        
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
                    totalJobsEvaluated: { $sum: "$jobsEvaluated" },
                    totalDuplicates: { $sum: "$duplicates" },
                    totalValidationDrops: { $sum: "$validationDrops" }
                }
            }
        ]).read('primary');
        const systemMetrics = globalSearchLogStats.length > 0 ? globalSearchLogStats[0] : {};
        
        
        const lastSuccess = await SearchLog.findOne({ status: "Success" }).sort({ createdAt: -1 }).read('primary');
        const latestRun = await SearchLog.findOne({ status: { $ne: "Running" } }).sort({ startedAt: -1, createdAt: -1 }).read('primary').lean();
        const latest = latestRun || {};
        const latestCompaniesScanned = latest.companiesScanned || latest.totalCompanies || 0;
        const latestSuccessfulCompanies = latest.successfulCompanies || 0;
        const latestFailedCompanies = latest.failedCompanies || 0;
        const latestCachedCompanies = latest.skippedRuns || 0;

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
                successRate: latestCompaniesScanned > 0 ? Math.round((latestSuccessfulCompanies / latestCompaniesScanned) * 100) : 100,
                failureRate: latestCompaniesScanned > 0 ? Math.round((latestFailedCompanies / latestCompaniesScanned) * 100) : 0,
                skippedRuns: latestCachedCompanies,
                lastSuccessfulRun: lastSuccess ? lastSuccess.createdAt : null,
                nextScheduledRun: pipelineState.nextRunTime
            },
            metrics: {
                "Actually Scraped": latestCompaniesScanned,
                "Cached Companies": latestCachedCompanies,
                "Successful Companies": latestSuccessfulCompanies,
                "Failed Companies": latestFailedCompanies,
                "Recovered Nodes": latest.retriedSuccessfully || 0,
                "Raw Jobs": latest.jobsFound || latest.totalJobs || 0,
                "Matched Jobs": latest.jobsMatched || latest.matchedJobs || 0,
                "AI Evaluations": latest.jobsEvaluated || latest.aiEvaluations || aiEvaluatedCount || 0,
                "Parser Failures": latest.parserOutdated || 0,
                "Validation Failures": latest.validationDrops || 0,
                "ATS Changed": latest.atsChanged || 0,
                "Cloudflare Blocks": latest.blocked || 0,
                "Average Runtime": latest.durationMs || 0,
                "Average Company Time": latest.averageCompanyTime || 0
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
