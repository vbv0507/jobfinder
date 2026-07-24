const axios = require('axios');
const NetworkInterceptor = require('./NetworkInterceptor');
const AdapterFactory = require('./AdapterFactory');

async function discoverEndpoint(company) {
    let trail = [];
    let url = company.careerUrl;
    
    if (!url) {
        trail.push({ stage: "Self-Healing", severity: "ERROR", message: "No career URL" });
        return { success: false, reason: "No career URL", trail };
    }

    try {
        trail.push({ stage: "Self-Healing", severity: "INFO", message: `Auto-Discovery started for ${company.name}` });
        
        const signatures = AdapterFactory.getNetworkSignatures();
        const intercepted = await NetworkInterceptor.discoverApi(url, signatures);
        
        if (intercepted.trail) {
             trail.push(...intercepted.trail);
        }

        if (intercepted.apiUrl) {
             trail.push({ stage: "Self-Healing", severity: "SUCCESS", message: `Network Interception succeeded for ${intercepted.ats}` });
             
             company.scraperConfig = company.scraperConfig || {};
             company.scraperConfig.apiUrl = intercepted.apiUrl;
             company.scraperConfig.apiMethod = intercepted.apiMethod;
             company.scraperConfig.apiHeaders = intercepted.apiHeaders;
             company.scraperConfig.apiPayload = intercepted.apiPayload;
             company.scraperConfig.ats = intercepted.ats;
             company.scraperConfig.lastVerified = new Date();
             
             company.ats = intercepted.ats;
             company.markModified('scraperConfig');
             await company.save();
             
             trail.push({ stage: "Self-Healing", severity: "SUCCESS", message: `Updated DB with new request template` });
             return { success: true, ats: intercepted.ats, apiEndpoint: intercepted.apiUrl, trail };
        }

        trail.push({ stage: "Self-Healing", severity: "WARN", message: "Failed to intercept recognized API" });
        return { success: false, reason: "Failed to intercept API", trail };

    } catch (e) {
        trail.push({ stage: "Self-Healing", severity: "ERROR", message: `Discovery Exception: ${e.message}` });
        return { success: false, reason: e.message, trail };
    }
}

module.exports = { discoverEndpoint };
