require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const RawJob = require('../models/RawJob');
    const MatchedJob = require('../models/MatchedJob');
    const RejectedJob = require('../models/RejectedJob');

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const telegramRawJobsToday = await RawJob.find(
        { 'sources.sourceChannel': { $exists: true, $ne: null }, createdAt: { $gte: todayStart } },
        { _id: 1 }
    ).lean();
    const rawJobIds = telegramRawJobsToday.map(r => r._id);

    console.log('Telegram RawJobs today         :', rawJobIds.length);
    
    if (rawJobIds.length > 0) {
        const [matched, rejected] = await Promise.all([
            MatchedJob.countDocuments({ rawJob: { $in: rawJobIds } }),
            RejectedJob.countDocuments({ rawJob: { $in: rawJobIds } })
        ]);
        console.log('MatchedJobs today (via rawJob) :', matched);
        console.log('RejectedJobs today (via rawJob):', rejected);
    }

    const total = await RawJob.countDocuments({ 'sources.sourceChannel': { $exists: true, $ne: null } });
    console.log('Total Telegram RawJobs (all)   :', total);

    const brokenMatch = await MatchedJob.countDocuments({ source: 'telegram', createdAt: { $gte: todayStart } });
    console.log('Old broken query result        :', brokenMatch, '(expected 0)');

    await mongoose.connection.close();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
