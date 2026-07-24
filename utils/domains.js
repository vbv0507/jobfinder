const DOMAINS = {
    BACKEND: ["backend", "node.js", "express", "java", "spring", "golang", "api", "server", "microservices"],
    FRONTEND: ["frontend", "react", "angular", "vue", "ui", "ux", "css", "html", "web developer"],
    MOBILE: ["mobile", "ios", "android", "react native", "swift", "kotlin", "flutter"],
    AI_ML: ["ai", "machine learning", "mlops", "data science", "llm", "deep learning", "computer vision", "nlp"],
    DATA_ENG: ["data engineer", "data pipeline", "spark", "hadoop", "etl", "data warehouse"],
    DEVOPS: ["devops", "kubernetes", "terraform", "site reliability", "sre", "aws", "gcp", "azure", "platform engineer"],
    QA: ["qa", "test engineer", "automation testing", "sdet", "quality assurance"],
    EMBEDDED: ["embedded", "firmware", "iot", "rtos", "microcontroller"],
    SWE: ["software engineer", "full stack", "backend", "frontend", "sde", "react", "node", "developer"],
    SECURITY: ["security", "cyber", "penetration", "infosec", "appsec"],
    DATA: ["data scientist", "data engineer", "machine learning", "ml engineer", "ai engineer", "data analyst", "analytics", "ai researcher"],
    DESIGN: ["ux designer", "ui designer", "product designer", "ux researcher", "ui/ux"],
    PRODUCT: ["product manager", "product owner", "technical product manager", "vp of product"],
    MARKETING: ["marketing manager", "growth hacker", "seo specialist", "content marketer", "marketing"],
    SALES: ["sales executive", "business development", "account executive", "sales manager", "sales"]
};


const classifyDomain = (text) => {
    text = text.toLowerCase();
    
    if (DOMAINS.SWE.some(role => text.includes(role))) return 'SWE';
    if (DOMAINS.DATA.some(role => text.includes(role))) return 'DATA';
    if (DOMAINS.DESIGN.some(role => text.includes(role))) return 'DESIGN';
    if (DOMAINS.PRODUCT.some(role => text.includes(role))) return 'PRODUCT';
    if (DOMAINS.MARKETING.some(role => text.includes(role))) return 'MARKETING';
    if (DOMAINS.SALES.some(role => text.includes(role))) return 'SALES';

    const scores = {};
    
    for (const [domain, keywords] of Object.entries(DOMAINS)) {
        let score = 0;
        for (const keyword of keywords) {
            
            const regex = new RegExp(`\\b${keyword.replace(/\./g, '\\.')}\\b`, 'i');
            if (regex.test(text)) {
                score += 1;
            }
        }
        scores[domain] = score;
    }

    
    let bestDomain = null;
    let maxScore = 0;
    
    for (const [domain, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            bestDomain = domain;
        }
    }
    
    
    return bestDomain || "UNKNOWN";
};

module.exports = {
    DOMAINS,
    classifyDomain
};
