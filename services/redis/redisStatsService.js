const { client } = require('../../config/redis');

const STATS_HASH_KEY = "stats:lifetime";

class RedisStatsService {
    /**
     * Increment lifetime metrics atomically
     * @param {Object} deltas - { total_scraped: 1, sde_fresher: 1, user_matched: 1, etc. }
     */
    static async incrementStats(deltas = {}) {
        try {
            for (const [field, inc] of Object.entries(deltas)) {
                if (inc) {
                    await client.hincrby(STATS_HASH_KEY, field, Number(inc));
                }
            }
        } catch (err) {
            console.warn("[RedisStats] Increment error:", err.message);
        }
    }

    /**
     * Get all lifetime metrics in O(1) time (< 1ms)
     */
    static async getLifetimeStats() {
        try {
            const raw = await client.hgetall(STATS_HASH_KEY);
            if (!raw || Object.keys(raw).length === 0) return null;

            return {
                totalScrapedLifetime: parseInt(raw.total_scraped || "0", 10),
                totalMatchedToUser: parseInt(raw.user_matched || "0", 10),
                totalSdeFresher: parseInt(raw.sde_fresher || "0", 10),
                totalSdeExp: parseInt(raw.sde_exp || "0", 10),
                totalNonSde: parseInt(raw.non_sde || "0", 10),
                userMatchedSdeFresher: parseInt(raw.user_matched_fresher || "0", 10),
                userMatchedSdeExp: parseInt(raw.user_matched_exp || "0", 10),
                userMatchedNonSde: parseInt(raw.user_matched_non_sde || "0", 10)
            };
        } catch (err) {
            return null;
        }
    }

    /**
     * Sync initial DB stats into Redis hash
     */
    static async seedLifetimeStats(stats) {
        try {
            await client.hset(STATS_HASH_KEY, "total_scraped", String(stats.totalScrapedLifetime || 0));
            await client.hset(STATS_HASH_KEY, "user_matched", String(stats.totalMatchedToUser || 0));
            await client.hset(STATS_HASH_KEY, "sde_fresher", String(stats.totalSdeFresher || 0));
            await client.hset(STATS_HASH_KEY, "sde_exp", String(stats.totalSdeExp || 0));
            await client.hset(STATS_HASH_KEY, "non_sde", String(stats.totalNonSde || 0));
            await client.hset(STATS_HASH_KEY, "user_matched_fresher", String(stats.userMatchedSdeFresher || 0));
            await client.hset(STATS_HASH_KEY, "user_matched_exp", String(stats.userMatchedSdeExp || 0));
            await client.hset(STATS_HASH_KEY, "user_matched_non_sde", String(stats.userMatchedNonSde || 0));
        } catch (err) {
            console.warn("[RedisStats] Seed error:", err.message);
        }
    }
}

module.exports = RedisStatsService;
