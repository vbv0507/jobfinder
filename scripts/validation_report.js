require('dotenv').config();
const mongoose = require('mongoose');
const MatchedJob = require('../models/MatchedJob');
const RawJob = require('../models/RawJob');

const validateUrl = (url) => {
    if (!url) return { valid: false, reason: 'Missing URL' };
    if (!url.startsWith('https://')) return { valid: false, reason: 'Non-HTTPS URL' };
    
    const invalidSubstrings = ['undefined', '//job/', 'samecorp', 'example', 'localhost', 'error=true'];
    const lowerUrl = url.toLowerCase();
    
    for (const sub of invalidSubstrings) {
        if (lowerUrl.includes(sub)) {
            return { valid: false, reason: `Contains dummy/malformed placeholder '${sub}'` };
        }
    }
    
    if (lowerUrl.includes('null')) {
        return { valid: false, reason: 'Contains null placeholder' };
    }
    
    try {
        const parsed = new URL(url);
        if (!parsed.hostname) return { valid: false, reason: 'Missing hostname' };
        if (parsed.hostname === 'api.smartrecruiters.com') return { valid: false, reason: 'Backend API URL rejected' };
    } catch (e) {
        return { valid: false, reason: 'Unparseable malformed URL' };
    }
    
    return { valid: true };
};

const runReport = async () => {
    console.log("=== URL Validation Report ===\n");
    
    const testCases = [
        "https://www.okta.com/company/careers/opportunity/8064490?gh_jid=8064490",
        "https://job-boards.greenhouse.io/samecorp?error=true",
        "https://boards.greenhouse.io/samecorp/jobs/999",
        "http://example.com/job/123",
        "https://paypal.wd1.myworkdayjobs.com/en-US/jobs/job/Chennai-Tamil-Nadu-India/Software-Engineer_R0136975-1",
        "https://jobs.smartrecruiters.com/ServiceNow/744000137550979",
        "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/123",
        "https://careers.paypal.com//job/123",
        "https://localhost:3000/apply",
        "https://company.com/job/undefined",
        "https://company.com/job/null"
    ];

    console.log("--- Rejected URLs ---");
    for (const url of testCases) {
        const result = validateUrl(url);
        if (!result.valid) {
            console.log(`[REJECTED] ${url}`);
            console.log(`   Reason: ${result.reason}`);
        }
    }
    
    console.log("\n--- Accepted URLs ---");
    for (const url of testCases) {
        const result = validateUrl(url);
        if (result.valid) {
            console.log(`[ACCEPTED] ${url}`);
        }
    }
    
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const jobs = await MatchedJob.find({}).limit(5);
        if (jobs.length > 0) {
            console.log("\n--- Sample DB Accepted URLs ---");
            jobs.forEach(j => {
                console.log(`[ACCEPTED] ${j.applyLink}`);
            });
        }
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
};

runReport();
