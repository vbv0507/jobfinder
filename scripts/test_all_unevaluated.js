require('dotenv').config();
const mongoose = require('mongoose');
const RawJob = require('../models/RawJob');
const Company = require('../models/Company');
const { processJobUrl } = require('../services/telegramService');
const { getSkipReason, getActiveProfile } = require('../services/pipeline/aiEvaluationService');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const unevaluated = await RawJob.find({
        'sources.sourceChannel': { $exists: true, $ne: null }, 
        createdAt: { $gte: todayStart },
        aiEvaluated: false
    });
    
    const profile = await getActiveProfile();
    let toEvaluate = [];

    for (const job of unevaluated) {
        if (!getSkipReason(job, profile)) {
            toEvaluate.push(job);
        }
    }

    console.log(`Found ${toEvaluate.length} jobs to evaluate.`);

    for (const rawJob of toEvaluate) {
        console.log(`Evaluating job: ${rawJob.applyLink}`);
        const company = await Company.findById(rawJob.company);
        const structuredData = {
            company: rawJob.companyName || company.name,
            role: rawJob.title,
            location: rawJob.location,
            experience: rawJob.experience
        };

        try {
            const result = await processJobUrl(rawJob.applyLink, company, profile, structuredData, "testChannel", "1234");
            console.log(`Result for ${rawJob.applyLink}:`, result);
        } catch (e) {
            console.error(`Error for ${rawJob.applyLink}:`, e);
        }
    }

    await mongoose.connection.close();
}

main().catch(console.error);
