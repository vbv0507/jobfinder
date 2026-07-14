const DOMAINS = {
    BACKEND: ["backend", "node.js", "express", "java", "spring", "golang", "api", "server", "microservices"],
    FRONTEND: ["frontend", "react", "angular", "vue", "ui", "ux", "css", "html", "web developer"],
    MOBILE: ["mobile", "ios", "android", "react native", "swift", "kotlin", "flutter"],
    AI_ML: ["ai", "machine learning", "mlops", "data science", "llm", "deep learning", "computer vision", "nlp"],
    DATA_ENG: ["data engineer", "data pipeline", "spark", "hadoop", "etl", "data warehouse"],
    DEVOPS: ["devops", "kubernetes", "terraform", "site reliability", "sre", "aws", "gcp", "azure", "platform engineer"],
    QA: ["qa", "test engineer", "automation testing", "sdet", "quality assurance"],
    EMBEDDED: ["embedded", "firmware", "iot", "rtos", "microcontroller"],
    SECURITY: ["security", "cyber", "penetration", "infosec", "appsec"]
};


const classifyDomain = (text) => {
    text = text.toLowerCase();
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
