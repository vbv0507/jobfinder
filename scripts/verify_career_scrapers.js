require('dotenv').config();
const mongoose = require('mongoose');
const chalk = require('chalk');
const Company = require('../models/Company');
const RawJob = require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');
const AdapterFactory = require('../services/ats/AdapterFactory');
const { getActiveProfile, runEvaluationPipeline } = require('../services/pipeline/aiEvaluationService');

async function verifyScrapers() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(chalk.bold.cyan('\n🌐 [Scraper & Match Verification] Checking Career Websites Directly...\n'));

    const profile = await getActiveProfile();

    // Select representative companies across key ATS types
    const atsTypes = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday'];
    const selectedCompanies = [];

    for (const ats of atsTypes) {
        const comp = await Company.findOne({ active: true, ats: ats });
        if (comp) selectedCompanies.push(comp);
    }

    console.log(chalk.white(`Selected ${selectedCompanies.length} companies for live website checking:`));
    selectedCompanies.forEach(c => console.log(` - ${c.name} (ATS: ${c.ats})`));
    console.log('');

    const aiState = {
        gemini: { available: true, requests: 0, success: 0, failed: 0 },
        groq: { available: true, requests: 0, success: 0, failed: 0 },
        openrouter: { available: true, requests: 0, success: 0, failed: 0 },
        litellm: { available: false },
        local: { disabled: true },
        calls: 0
    };

    const results = [];

    for (const company of selectedCompanies) {
        console.log(chalk.bold.blue(`--------------------------------------------------`));
        console.log(chalk.bold.white(`Checking Website: ${company.name} [${company.ats.toUpperCase()}]`));
        
        try {
            const adapter = AdapterFactory.getAdapter(company);
            const startTime = Date.now();
            const liveJobs = await adapter.searchJobs();
            const scrapeDurationMs = Date.now() - startTime;

            console.log(chalk.green(`✓ Scraper returned ${liveJobs.length} live jobs from website in ${scrapeDurationMs}ms`));

            // Compare with existing DB records for this company
            const dbJobCount = await RawJob.countDocuments({ company: company._id });
            const dbMatchedCount = await MatchedJob.countDocuments({ company: company._id });
            console.log(chalk.gray(`  DB Raw Jobs: ${dbJobCount} | DB Matched Jobs: ${dbMatchedCount}`));

            // Test evaluation on up to 2 candidate jobs from this scrape
            let evaluatedCount = 0;
            let matchCount = 0;

            for (const job of liveJobs.slice(0, 3)) {
                console.log(chalk.cyan(`  Evaluating job: "${job.title}" (${job.location || 'Remote'})`));
                const evalResult = await runEvaluationPipeline(job, profile, aiState);

                if (evalResult.skipped) {
                    console.log(chalk.gray(`    ↳ Skipped: ${evalResult.reason}`));
                } else if (evalResult.analysis) {
                    evaluatedCount++;
                    const score = evalResult.analysis.score;
                    const suitable = evalResult.analysis.suitable;
                    const provider = evalResult.analysis.provider;
                    console.log(chalk.white(`    ↳ Scored by ${provider}: `) + (suitable ? chalk.green.bold(`${score}/100 [MATCHED]`) : chalk.yellow(`${score}/100 [REJECTED]`)));
                    if (suitable) matchCount++;
                }
            }

            results.push({
                company: company.name,
                ats: company.ats,
                liveJobsFound: liveJobs.length,
                dbRawJobs: dbJobCount,
                dbMatched: dbMatchedCount,
                status: 'OK'
            });

        } catch (err) {
            console.error(chalk.red(`✗ Error scraping ${company.name}: ${err.message}`));
            results.push({
                company: company.name,
                ats: company.ats,
                liveJobsFound: 0,
                status: 'FAILED: ' + err.message
            });
        }
    }

    console.log(chalk.bold.cyan('\n=================================================='));
    console.log(chalk.bold.cyan('📊 [Live Website Scraper Verification Results]'));
    console.table(results);
    console.log(chalk.bold.cyan('==================================================\n'));

    await mongoose.connection.close();
}

verifyScrapers().catch(console.error);
