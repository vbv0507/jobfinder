const chalk = require("chalk");

let redisClient = null;
let isRedisConnected = false;

// Resilient In-Memory Fallback Store
class InMemoryRedisFallback {
    constructor() {
        this.store = new Map();
        this.hashes = new Map();
        this.lists = new Map();
        this.expiries = new Map();
    }

    _checkExpiry(key) {
        if (this.expiries.has(key) && Date.now() > this.expiries.get(key)) {
            this.store.delete(key);
            this.hashes.delete(key);
            this.lists.delete(key);
            this.expiries.delete(key);
            return true;
        }
        return false;
    }

    async get(key) {
        if (this._checkExpiry(key)) return null;
        return this.store.has(key) ? this.store.get(key) : null;
    }

    async set(key, value, ...args) {
        this.store.set(key, typeof value === "string" ? value : JSON.stringify(value));
        
        // Handle EX (seconds) or PX (milliseconds)
        if (args.length >= 2) {
            const mode = String(args[0]).toUpperCase();
            const ttl = Number(args[1]);
            if (mode === "EX") {
                this.expiries.set(key, Date.now() + ttl * 1000);
            } else if (mode === "PX") {
                this.expiries.set(key, Date.now() + ttl);
            }
        }
        return "OK";
    }

    async setnx(key, value) {
        if (this.store.has(key) && !this._checkExpiry(key)) {
            return 0;
        }
        await this.set(key, value);
        return 1;
    }

    async del(key) {
        this.store.delete(key);
        this.hashes.delete(key);
        this.lists.delete(key);
        this.expiries.delete(key);
        return 1;
    }

    async incrby(key, increment = 1) {
        this._checkExpiry(key);
        const current = parseInt(this.store.get(key) || "0", 10);
        const next = current + Number(increment);
        this.store.set(key, String(next));
        return next;
    }

    async hget(key, field) {
        if (this._checkExpiry(key)) return null;
        const hash = this.hashes.get(key);
        return hash && hash.has(field) ? hash.get(field) : null;
    }

    async hset(key, field, value) {
        if (!this.hashes.has(key)) this.hashes.set(key, new Map());
        const hash = this.hashes.get(key);
        hash.set(field, typeof value === "string" ? value : JSON.stringify(value));
        return 1;
    }

    async hincrby(key, field, increment = 1) {
        if (!this.hashes.has(key)) this.hashes.set(key, new Map());
        const hash = this.hashes.get(key);
        const current = parseInt(hash.get(field) || "0", 10);
        const next = current + Number(increment);
        hash.set(field, String(next));
        return next;
    }

    async hgetall(key) {
        if (this._checkExpiry(key)) return {};
        const hash = this.hashes.get(key);
        if (!hash) return {};
        const obj = {};
        for (const [k, v] of hash.entries()) {
            obj[k] = v;
        }
        return obj;
    }

    async expire(key, seconds) {
        if (this.store.has(key) || this.hashes.has(key) || this.lists.has(key)) {
            this.expiries.set(key, Date.now() + Number(seconds) * 1000);
            return 1;
        }
        return 0;
    }

    async pexpire(key, milliseconds) {
        if (this.store.has(key) || this.hashes.has(key) || this.lists.has(key)) {
            this.expiries.set(key, Date.now() + Number(milliseconds));
            return 1;
        }
        return 0;
    }

    async lpush(key, ...elements) {
        if (!this.lists.has(key)) this.lists.set(key, []);
        const list = this.lists.get(key);
        list.unshift(...elements.map(e => typeof e === "string" ? e : JSON.stringify(e)));
        return list.length;
    }

    async rpop(key) {
        if (this._checkExpiry(key)) return null;
        const list = this.lists.get(key);
        if (!list || list.length === 0) return null;
        return list.pop();
    }

    async llen(key) {
        if (this._checkExpiry(key)) return 0;
        const list = this.lists.get(key);
        return list ? list.length : 0;
    }

    async lrange(key, start, stop) {
        if (this._checkExpiry(key)) return [];
        const list = this.lists.get(key) || [];
        const end = stop === -1 ? list.length : stop + 1;
        return list.slice(start, end);
    }
}

const fallbackInstance = new InMemoryRedisFallback();

function getRedisClient() {
    if (redisClient) return redisClient;

    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
    const redisHost = process.env.REDIS_HOST;

    if (!redisUrl && !redisHost) {
        console.log(chalk.gray("[Redis] No REDIS_URL configured. Running in High-Speed In-Memory Fallback mode."));
        redisClient = fallbackInstance;
        return redisClient;
    }

    try {
        let Redis;
        try {
            Redis = require("ioredis");
        } catch (e) {
            console.warn(chalk.yellow("[Redis] ioredis module not found. Falling back to in-memory store."));
            redisClient = fallbackInstance;
            return redisClient;
        }

        const options = {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            retryStrategy(times) {
                if (times > 5) {
                    console.warn(chalk.yellow("[Redis] Connection attempts exhausted. Falling back to in-memory."));
                    return null;
                }
                return Math.min(times * 200, 2000);
            }
        };

        const client = redisUrl ? new Redis(redisUrl, options) : new Redis({
            host: redisHost,
            port: Number(process.env.REDIS_PORT || 6379),
            password: process.env.REDIS_PASSWORD || undefined,
            ...options
        });

        client.on("connect", () => {
            isRedisConnected = true;
            console.log(chalk.green("⚡ [Redis] Connected successfully to Redis server."));
        });

        client.on("error", (err) => {
            isRedisConnected = false;
            console.warn(chalk.yellow(`[Redis Warning] ${err.message}`));
        });

        redisClient = client;
        return redisClient;
    } catch (err) {
        console.warn(chalk.yellow(`[Redis Init Error] ${err.message}. Using In-Memory fallback.`));
        redisClient = fallbackInstance;
        return redisClient;
    }
}

module.exports = {
    getRedisClient,
    get client() { return getRedisClient(); },
    isAvailable: () => isRedisConnected || redisClient === fallbackInstance
};
