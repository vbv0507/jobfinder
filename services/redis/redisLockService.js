const { client } = require('../../config/redis');
const crypto = require('crypto');

class RedisLockService {
    /**
     * Acquire a distributed lock.
     * @param {string} lockKey - e.g. "pipeline_global_lock"
     * @param {number} ttlMs - TTL in milliseconds (default 60000ms = 1 min)
     * @returns {Promise<{acquired: boolean, token: string|null, release: Function}>}
     */
    static async acquireLock(lockKey, ttlMs = 60000) {
        const token = crypto.randomUUID();
        const key = `lock:${lockKey}`;

        try {
            // SET key token NX PX ttlMs
            const result = await client.set(key, token, "PX", ttlMs, "NX");
            const acquired = result === "OK" || result === 1;

            return {
                acquired,
                token: acquired ? token : null,
                key,
                release: async () => {
                    if (!acquired) return false;
                    return await this.releaseLock(lockKey, token);
                }
            };
        } catch (err) {
            console.warn(`[RedisLock] Failed to acquire lock ${lockKey}:`, err.message);
            return { acquired: false, token: null, release: async () => false };
        }
    }

    /**
     * Release a distributed lock safely if token matches.
     * @param {string} lockKey 
     * @param {string} token 
     */
    static async releaseLock(lockKey, token) {
        const key = `lock:${lockKey}`;
        try {
            const currentToken = await client.get(key);
            if (currentToken === token) {
                await client.del(key);
                return true;
            }
            return false;
        } catch (err) {
            console.warn(`[RedisLock] Release error for ${lockKey}:`, err.message);
            return false;
        }
    }

    /**
     * Heartbeat renew lock TTL
     * @param {string} lockKey 
     * @param {string} token 
     * @param {number} ttlMs 
     */
    static async renewLock(lockKey, token, ttlMs = 60000) {
        const key = `lock:${lockKey}`;
        try {
            const currentToken = await client.get(key);
            if (currentToken === token) {
                await client.pexpire(key, ttlMs);
                return true;
            }
            return false;
        } catch (err) {
            return false;
        }
    }
}

module.exports = RedisLockService;
