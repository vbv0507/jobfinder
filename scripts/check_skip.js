require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const RawJob = require('../models/RawJob');
    const { getSkipReason } = require('../services/pipeline/aiEvaluationService');
    const fallbackProfile = require('../profile.js');

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const telegramRawJobsToday = await RawJob.find(
        { 'sources.sourceChannel': { $exists: true, $ne: null }, createdAt: { $gte: todayStart } }
    ).lean();

    console.log('Total Telegram RawJobs today:', telegramRawJobsToday.length);

    let skippedCount = 0;
    let willEvaluateCount = 0;
    const skipReasons = {};

    telegramRawJobsToday.forEach(job => {
        const reason = getSkipReason(job, fallbackProfile);
        if (reason) {
            skippedCount++;
            skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        } else {
            willEvaluateCount++;
            console.log('WILL EVALUATE:', job.title, '|', job.location);
        }
    });

    console.log('\n--- SUMMARY ---');
    console.log('Total Jobs   :', telegramRawJobsToday.length);
    console.log('Skipped      :', skippedCount);
    console.log('Will Evaluate:', willEvaluateCount);

    console.log('\nSkip Reasons:');
    for (const [reason, count] of Object.entries(skipReasons)) {
        console.log(`- ${count}: ${reason}`);
    }

    await mongoose.connection.close();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
