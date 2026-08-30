const { client } = require('../../config/redis');
const pLimit = require('p-limit');

const RAW_QUEUE_KEY = "queue:raw_jobs";
const MAX_CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY || 8);

class RedisQueueService {
    /**
     * Push job(s) to the Raw Queue
     * @param {Object|Array} jobs 
     */
    static async pushJobs(jobs) {
        const jobList = Array.isArray(jobs) ? jobs : [jobs];
        if (jobList.length === 0) return 0;

        try {
            const payloads = jobList.map(j => JSON.stringify(j));
            await client.lpush(RAW_QUEUE_KEY, ...payloads);
            return payloads.length;
        } catch (err) {
            console.warn("[RedisQueue] Failed to push jobs:", err.message);
            return 0;
        }
    }

    /**
     * Pop next job from the queue
     */
    static async popJob() {
        try {
            const raw = await client.rpop(RAW_QUEUE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Get queue length
     */
    static async getQueueSize() {
        try {
            return await client.llen(RAW_QUEUE_KEY);
        } catch (err) {
            return 0;
        }
    }

    /**
     * Process all queue jobs concurrently using worker pool
     * @param {Function} workerFn - async (job) => result
     * @param {number} concurrency - default 5
     */
    static async processQueue(workerFn, concurrency = MAX_CONCURRENCY) {
        const limit = pLimit(concurrency);
        const results = [];
        const tasks = [];

        let job;
        while ((job = await this.popJob()) !== null) {
            const currentJob = job;
            tasks.push(
                limit(async () => {
                    try {
                        const res = await workerFn(currentJob);
                        results.push({ job: currentJob, success: true, result: res });
                    } catch (err) {
                        results.push({ job: currentJob, success: false, error: err.message });
                    }
                })
            );
        }

        await Promise.all(tasks);
        return results;
    }
}

module.exports = RedisQueueService;
