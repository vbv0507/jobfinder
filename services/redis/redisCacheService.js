const { client } = require('../../config/redis');
const crypto = require('crypto');

class RedisCacheService {
    /**
     * Compute deterministic hash for an AI evaluation request
     */
    static computeJobEvalKey(job, profile) {
        const title = (job.title || job.role || "").trim().toLowerCase();
        const desc = (job.description || "").slice(0, 500).trim().toLowerCase();
        const exp = (job.experience || "").trim().toLowerCase();
        const profHash = (profile.skills || []).slice(0, 5).join(",");
        
        const raw = `${title}|${desc}|${exp}|${profHash}`;
        const hash = crypto.createHash("md5").update(raw).digest("hex");
        return `cache:ai_eval:${hash}`;
    }

    /**
     * Get cached AI evaluation result
     */
    static async getCachedEvaluation(job, profile) {
        try {
            const key = this.computeJobEvalKey(job, profile);
            const cached = await client.get(key);
            if (cached) {
                return JSON.parse(cached);
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Store AI evaluation result with TTL (default 14 days)
     */
    static async setCachedEvaluation(job, profile, analysis, ttlSeconds = 14 * 24 * 3600) {
        try {
            const key = this.computeJobEvalKey(job, profile);
            await client.set(key, JSON.stringify(analysis), "EX", ttlSeconds);
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Get ATS Scraper ETag / Content Hash cache
     */
    static async getAtsCache(companyName) {
        try {
            const key = `cache:ats:${companyName.toLowerCase().replace(/\s+/g, "_")}`;
            const cached = await client.get(key);
            return cached ? JSON.parse(cached) : null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Set ATS Scraper ETag / Content Hash cache (TTL 12 hours)
     */
    static async setAtsCache(companyName, data, ttlSeconds = 12 * 3600) {
        try {
            const key = `cache:ats:${companyName.toLowerCase().replace(/\s+/g, "_")}`;
            await client.set(key, JSON.stringify(data), "EX", ttlSeconds);
            return true;
        } catch (err) {
            return false;
        }
    }
}

module.exports = RedisCacheService;
