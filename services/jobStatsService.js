const MatchedJob = require("../models/MatchedJob");
const RejectedJob = require("../models/RejectedJob");
const RawJob = require("../models/RawJob");
const SearchLog = require("../models/SearchLog");
const RedisStatsService = require("./redis/redisStatsService");

let cachedStats = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

const SDE_REGEX = /sde|software|developer|backend|frontend|fullstack|full-stack|web|engineer|node|react|java|python|golang|c\+\+|api|cloud|devops|data engineer|systems engineer|programmer/i;
const FRESHER_REGEX = /0-|0 to|0-1|0-2|0 - 1|0 - 2|fresher|intern|graduate|entry|trainee|2024|2025|2026|2027|^0\s*y|associate|junior/i;
const EXP_REGEX = /\b(2\+|3\+|4\+|5\+|6\+|7\+|8\+|senior|lead|principal|staff|manager|director|architect|head|[2-9]-[0-9]|[3-9]\+|[3-9]\s*years)\b/i;

function classifyJob(job) {
    const title = (job.role || job.title || "").toLowerCase();
    const exp = (job.experienceMatch || job.experience || "").toLowerCase();
    const reason = (job.reason || "").toLowerCase();
    const domain = (job.jobDomain || "").toLowerCase();

    const isSde = SDE_REGEX.test(title) || domain.includes("backend") || domain.includes("frontend") || domain.includes("fullstack") || domain.includes("sde");
    
    let isFresher = false;
    if (FRESHER_REGEX.test(exp) || FRESHER_REGEX.test(title) || /fresher|intern|entry level|0-1|0-2|new grad/i.test(reason)) {
        isFresher = true;
    } else if (EXP_REGEX.test(title) || EXP_REGEX.test(exp) || /experienced|senior|3\+|5\+/i.test(reason)) {
        isFresher = false;
    } else {
        isFresher = false;
    }

    return { isSde, isFresher };
}

async function computeLifetimeStats() {
    const [matched, rejected, pendingRawCount, totalRawCount, searchLogAgg] = await Promise.all([
        MatchedJob.find({}, "role jobDomain experienceMatch reason score").lean(),
        RejectedJob.find({}, "role jobDomain experienceMatch reason score").lean(),
        RawJob.countDocuments({ aiEvaluated: { $ne: true } }),
        RawJob.countDocuments(),
        SearchLog.aggregate([
            {
                $group: {
                    _id: null,
                    totalJobsFound: { $sum: "$jobsFound" },
                    totalJobsScraped: { $sum: "$jobsScraped" }
                }
            }
        ])
    ]);

    let matchedSdeFresher = 0;
    let matchedSdeExp = 0;
    let matchedNonSdeFresher = 0;
    let matchedNonSdeExp = 0;

    matched.forEach((j) => {
        const { isSde, isFresher } = classifyJob(j);
        if (isSde) {
            if (isFresher) matchedSdeFresher++;
            else matchedSdeExp++;
        } else {
            if (isFresher) matchedNonSdeFresher++;
            else matchedNonSdeExp++;
        }
    });

    let rejSdeFresher = 0;
    let rejSdeExp = 0;
    let rejNonSdeFresher = 0;
    let rejNonSdeExp = 0;

    rejected.forEach((j) => {
        const { isSde, isFresher } = classifyJob(j);
        if (isSde) {
            if (isFresher) rejSdeFresher++;
            else rejSdeExp++;
        } else {
            if (isFresher) rejNonSdeFresher++;
            else rejNonSdeExp++;
        }
    });

    const totalMatched = matched.length;
    const totalRejected = rejected.length;
    const totalProcessed = totalMatched + totalRejected;

    const totalSdeFresher = matchedSdeFresher + rejSdeFresher;
    const totalSdeExp = matchedSdeExp + rejSdeExp;
    const totalSde = totalSdeFresher + totalSdeExp;
    const totalNonSde = (matchedNonSdeFresher + matchedNonSdeExp + rejNonSdeFresher + rejNonSdeExp);

    const cumulativeScraped = (searchLogAgg && searchLogAgg[0] && searchLogAgg[0].totalJobsScraped) || totalProcessed;

    const sdeMarketShare = totalProcessed > 0 ? Math.round((totalSde / totalProcessed) * 100) : 0;
    const fresherPercentageOfSde = totalSde > 0 ? Math.round((totalSdeFresher / totalSde) * 100) : 0;
    const userMatchRate = totalProcessed > 0 ? ((totalMatched / totalProcessed) * 100).toFixed(2) : "0.00";

    return {
        totalScrapedLifetime: totalProcessed,
        cumulativeScrapedRuns: cumulativeScraped,
        totalMatchedToUser: totalMatched,
        totalRejected: totalRejected,
        rawQueueCount: pendingRawCount,
        totalRawInDatabase: totalRawCount,
        
        // SDE Breakdown
        totalSde,
        totalSdeFresher,
        totalSdeExp,
        totalNonSde,

        // User Profile Specific Matched Breakdown
        userMatchedSdeFresher: matchedSdeFresher,
        userMatchedSdeExp: matchedSdeExp,
        userMatchedNonSde: matchedNonSdeFresher + matchedNonSdeExp,

        // Percentages & Market Metrics
        sdeMarketShare,
        fresherPercentageOfSde,
        userMatchRate,

        lastCalculatedAt: new Date()
    };
}

async function getLifetimeStats(force = false) {
    const now = Date.now();
    if (!force) {
        if (cachedStats && (now - lastCacheTime < CACHE_TTL_MS)) {
            return cachedStats;
        }
        try {
            const redisStats = await RedisStatsService.getLifetimeStats();
            if (redisStats && redisStats.totalScrapedLifetime > 0) {
                cachedStats = {
                    ...redisStats,
                    sdeMarketShare: redisStats.totalScrapedLifetime > 0 ? Math.round(((redisStats.totalSdeFresher + redisStats.totalSdeExp) / redisStats.totalScrapedLifetime) * 100) : 0,
                    fresherPercentageOfSde: (redisStats.totalSdeFresher + redisStats.totalSdeExp) > 0 ? Math.round((redisStats.totalSdeFresher / (redisStats.totalSdeFresher + redisStats.totalSdeExp)) * 100) : 0,
                    userMatchRate: redisStats.totalScrapedLifetime > 0 ? ((redisStats.totalMatchedToUser / redisStats.totalScrapedLifetime) * 100).toFixed(2) : "0.00",
                    lastCalculatedAt: new Date()
                };
                lastCacheTime = now;
                return cachedStats;
            }
        } catch (e) {}
    }

    try {
        cachedStats = await computeLifetimeStats();
        lastCacheTime = now;
        RedisStatsService.seedLifetimeStats(cachedStats).catch(() => {});
        return cachedStats;
    } catch (err) {
        console.error("[JobStatsService] Error calculating lifetime stats:", err);
        if (cachedStats) return cachedStats;
        throw err;
    }
}

module.exports = {
    getLifetimeStats,
    classifyJob
};
