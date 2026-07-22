const validateConfig = () => {
    const requiredKeys = ['MONGO_URI'];
    const optionalKeys = [
        'TELEGRAM_SESSION',
        'TELEGRAM_API_ID',
        'TELEGRAM_API_HASH',
        'GEMINI_API_KEY',
        'GROQ_API_KEY',
        'ZAI_API_KEY',
        'CRON_ENABLED',
        'ADMIN_API_KEY',
        'EMAIL_USER',
        'EMAIL_PASS',
        'EMAIL_TO'
    ];

    const missingRequired = requiredKeys.filter(key => !process.env[key]);
    const missingOptional = optionalKeys.filter(key => !process.env[key]);

    console.log("========================================");
    console.log("Startup Configuration Report");
    console.log("========================================");
    
    if (missingRequired.length > 0) {
        console.error(`[CRITICAL] Missing required keys: ${missingRequired.join(', ')}`);
        console.log("========================================");
        throw new Error(`Startup failed. Missing required environment variables: ${missingRequired.join(', ')}`);
    }

    if (missingOptional.length > 0) {
        console.warn(`[WARN] Missing optional keys (some features may be disabled): ${missingOptional.join(', ')}`);
    } else {
        console.log("[INFO] All configuration keys are present.");
    }
    
    console.log("========================================");
};

module.exports = { validateConfig };
