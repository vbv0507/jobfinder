require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const RejectedJob = require('../models/RejectedJob');

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const rejections = await RejectedJob.find({ createdAt: { $gte: todayStart } }).lean();
    console.log('Total Rejected Jobs today:', rejections.length);

    const reasonCounts = {};
    rejections.forEach(r => {
        const reason = r.reason || 'No reason provided';
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    console.log('\nRejection Reasons:');
    for (const [reason, count] of Object.entries(reasonCounts)) {
        console.log(`- ${count}: ${reason.substring(0, 100)}`);
    }

    const providerCounts = {};
    rejections.forEach(r => {
        const p = r.provider || 'unknown';
        providerCounts[p] = (providerCounts[p] || 0) + 1;
    });
    console.log('\nProviders used:', providerCounts);

    await mongoose.connection.close();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
