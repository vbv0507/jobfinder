// Telegram message se aaye URLs ko dekh ke decide karta hai
// ki ye job platform ka link hai ya noise (youtube, whatsapp, etc.)

const JOB_PLATFORM_RULES = [
    { pattern: /greenhouse\.io/i,         strategy: "greenhouse" },
    { pattern: /lever\.co/i,              strategy: "lever" },
    { pattern: /myworkdayjobs\.com/i,     strategy: "workday" },
    { pattern: /smartrecruiters\.com/i,   strategy: "smartrecruiters" },
    { pattern: /careers\.kula\.ai/i,      strategy: "generic-html" },
    { pattern: /linkedin\.com\/jobs/i,    strategy: "generic-html" },
    { pattern: /naukri\.com/i,            strategy: "generic-html" },
    { pattern: /instahyre\.com/i,         strategy: "generic-html" },
    { pattern: /internshala\.com/i,       strategy: "generic-html" },
    { pattern: /wellfound\.com/i,         strategy: "generic-html" },
    { pattern: /cutshort\.io/i,           strategy: "generic-html" },
];

// Ye domains job links nahi hain — skip karo
const BLOCKED_DOMAINS = [
    /youtu\.be/i,
    /youtube\.com/i,
    /whatsapp\.com/i,
    /t\.me/i,
    /telegram\.me/i,
    /instagram\.com/i,
    /twitter\.com/i,
    /x\.com/i,
    /courses\./i,
    /udemy\.com/i,
    /bit\.ly/i,
];

// Message text se saare URLs extract karta hai
const extractUrls = (text = "") => {
    const matches = text.match(/https?:\/\/[^\s]+/g) || [];
    // Clean trailing punctuation
    return matches.map(url => url.replace(/[.,)\]]+$/, ""));
};

// URL job platform ka hai ya nahi — aur kaunsi strategy use karni hai
const getUrlStrategy = (url) => {
    // Pehle blocked domains check karo
    const isBlocked = BLOCKED_DOMAINS.some(pattern => pattern.test(url));
    if (isBlocked) {
        return null;
    }

    // Job platform match dhundo
    const rule = JOB_PLATFORM_RULES.find(r => r.pattern.test(url));
    if (rule) {
        return rule.strategy;
    }

    // Unknown URL — skip karo, noise ho sakta hai
    return null;
};

module.exports = {
    extractUrls,
    getUrlStrategy,
};