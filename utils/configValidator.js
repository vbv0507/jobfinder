const validateConfig = () => {
    const requiredKeys = [
        'MONGO_URI',
        'TELEGRAM_SESSION',
        'TELEGRAM_API_ID',
        'TELEGRAM_API_HASH',
        'GEMINI_API_KEY',
        'GROQ_API_KEY',
        'ZAI_API_KEY',
        'CRON_ENABLED'
    ];

    const missing = requiredKeys.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.warn(`[WARN] Startup Validation Failed: Missing required configuration keys: ${missing.join(', ')}`);
    }
};

module.exports = { validateConfig };
