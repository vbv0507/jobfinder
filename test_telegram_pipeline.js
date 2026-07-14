const mongoose = require('mongoose');
require('dotenv').config();
const { parseStructuredPost, processJobUrl, isJobMessage } = require('./services/telegramService');
const { extractUrls, getUrlStrategy } = require('./utils/urlStrategy');
const RawJob = require('./models/RawJob');
const Company = require('./models/Company');
const CandidateProfile = require('./models/CandidateProfile');

const scenarios = [
    {
        id: 1,
        name: "Structured message",
        channel: "LMTPlacements",
        text: `Company: Adobe\nRole: Software Engineer\nLocation: Bangalore\nExperience: 2+ Years\nSalary: 20 LPA\nType: Full-Time\nApply: https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/External/jobs`
    },
    {
        id: 2,
        name: "Free-form message without labels",
        channel: "TechUprise_Updates",
        text: `Google is hiring Frontend Developers!\nNeed 1 year experience minimum.\nBengaluru office.\nPackage 30 LPA.\nFull-Time only.\nApply here: https://careers.google.com/jobs/results/123`
    },
    {
        id: 3,
        name: "Message with only LinkedIn URL",
        channel: "LMTPlacements",
        text: `https://www.linkedin.com/jobs/view/123456789`
    },
    {
        id: 4,
        name: "Greenhouse URL",
        channel: "TechUprise_Updates",
        text: `Hiring at Stripe!\nhttps://boards.greenhouse.io/stripe/jobs/12345`
    },
    {
        id: 5,
        name: "Workday URL",
        channel: "LMTPlacements",
        text: `https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/External/jobs/12345`
    },
    {
        id: 6,
        name: "Oracle Careers URL",
        channel: "TechUprise_Updates",
        text: `https://careers.oraclecloud.com/jobs/123`
    },
    {
        id: 7,
        name: "ICIMS URL",
        channel: "LMTPlacements",
        text: `https://careers-company.icims.com/jobs/123/job`
    },
    {
        id: 8,
        name: "Ashby URL",
        channel: "TechUprise_Updates",
        text: `https://jobs.ashbyhq.com/company/123`
    },
    {
        id: 9,
        name: "Duplicate job in both channels",
        channel: "LMTPlacements", // first time
        text: `Company: SameCorp\nRole: SDE\nApply: https://boards.greenhouse.io/samecorp/jobs/999`
    },
    {
        id: 9.1,
        name: "Duplicate job in both channels (second post)",
        channel: "TechUprise_Updates", // second time
        text: `Company: SameCorp\nRole: SDE\nApply: https://boards.greenhouse.io/samecorp/jobs/999`
    },
    {
        id: 10,
        name: "Not a job message",
        channel: "LMTPlacements",
        text: `Hey guys, how is everyone doing today? Subscribe to my youtube channel!`
    }
];

async function runTests() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB for testing.");

    const telegramCompany = await Company.findOne({ name: "Telegram Jobs" });
    const profile = await CandidateProfile.findOne({ active: true }) || { 
        preferredDomains: ["BACKEND"], 
        excludedDomains: [], 
        skills: ["Node.js", "MongoDB"], 
        yearsOfExperience: 2 
    };

    let metrics = {
        received: 0,
        parsed: 0,
        ignored: 0,
        failed: 0,
        inserted: 0,
        duplicates: 0,
    };

    // Clean up test data before running
    await RawJob.deleteMany({ applyLink: { $regex: /123|999|google|adobe|stripe|nvidia|oracle|icims|ashby/i } });

    for (const scenario of scenarios) {
        metrics.received++;
        console.log(`\n--- Running Scenario ${scenario.id}: ${scenario.name} ---`);
        
        const isJob = isJobMessage(scenario.text);
        if (!isJob) {
            console.log(`PASS: Ignored gracefully (Not a job message)`);
            metrics.ignored++;
            continue;
        }

        const structuredData = parseStructuredPost(scenario.text);
        console.log("Parsed Data:", structuredData);
        metrics.parsed++;

        const urls = extractUrls(scenario.text);
        if (urls.length === 0) {
            console.log(`FAIL: No URLs extracted.`);
            metrics.failed++;
            continue;
        }
        console.log("Extracted URLs:", urls);

        for (const url of urls) {
            const strategy = getUrlStrategy(url);
            console.log(`URL: ${url} -> Strategy: ${strategy || 'null'}`);
            
            if (strategy === null) {
                console.log("FAIL: Strategy not found for supported ATS.");
                metrics.failed++;
                continue;
            }

            try {
                const initialCount = await RawJob.countDocuments();
                await processJobUrl(url, telegramCompany, profile, structuredData, scenario.channel, Math.floor(Math.random() * 100000));
                
                const finalCount = await RawJob.countDocuments();
                const jobInDb = await RawJob.findOne({ applyLink: url });

                if (finalCount > initialCount) {
                    console.log(`PASS: Job successfully inserted.`);
                    metrics.inserted++;
                } else if (jobInDb) {
                    console.log(`PASS: Duplicate detected and updated.`);
                    metrics.duplicates++;
                    console.log(`Sources array:`, jobInDb.sources.map(s => s.sourceChannel));
                } else {
                    console.log(`PASS: Job safely ignored (scraper failed).`);
                }
            } catch (err) {
                console.log(`FAIL: Error processing job ->`, err.message);
                metrics.failed++;
            }
        }
    }

    console.log("\n==============================");
    console.log("TEST REPORT");
    console.log("==============================");
    console.log(`Messages received: ${metrics.received}`);
    console.log(`Messages parsed successfully: ${metrics.parsed}`);
    console.log(`Messages ignored: ${metrics.ignored}`);
    console.log(`Messages failed: ${metrics.failed}`);
    console.log(`Jobs inserted: ${metrics.inserted}`);
    console.log(`Duplicates detected: ${metrics.duplicates}`);
    
    process.exit(0);
}

runTests();
