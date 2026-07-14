


const JOB_PLATFORM_RULES = [
    { pattern: /greenhouse\.io/i,         strategy: "greenhouse" },
    { pattern: /lever\.co/i,              strategy: "lever" },
    { pattern: /myworkdayjobs\.com/i,     strategy: "workday" },
    { pattern: /smartrecruiters\.com/i,   strategy: "smartrecruiters" },
    { pattern: /careers\.kula\.ai/i,      strategy: "generic-html" },
    { pattern: /linkedin\.com\/jobs/i,    strategy: "generic-html" },
    { pattern: /oraclecloud\.com/i,       strategy: "generic-html" },
    { pattern: /icims\.com/i,             strategy: "generic-html" },
    { pattern: /ashbyhq\.com/i,           strategy: "generic-html" },
    { pattern: /successfactors\.com/i,    strategy: "generic-html" },
    { pattern: /careers\./i,              strategy: "generic-html" },
    { pattern: /jobs\./i,                 strategy: "generic-html" },
    { pattern: /naukri\.com/i,            strategy: "generic-html" },
    { pattern: /instahyre\.com/i,         strategy: "generic-html" },
    { pattern: /internshala\.com/i,       strategy: "generic-html" },
    { pattern: /wellfound\.com/i,         strategy: "generic-html" },
    { pattern: /cutshort\.io/i,           strategy: "generic-html" },
];


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


const extractUrls = (text = "") => {
    const matches = text.match(/https?:\/\/[^\s]+/g) || [];
    
    return matches.map(url => url.replace(/[.,)\]]+$/, ""));
};


const getUrlStrategy = (url) => {
    
    const isBlocked = BLOCKED_DOMAINS.some(pattern => pattern.test(url));
    if (isBlocked) {
        return null;
    }

    
    const rule = JOB_PLATFORM_RULES.find(r => r.pattern.test(url));
    if (rule) {
        return rule.strategy;
    }

    
    return null;
};

module.exports = {
    extractUrls,
    getUrlStrategy,
};