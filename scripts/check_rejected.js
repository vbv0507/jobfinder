require('dotenv').config();
const mongoose = require('mongoose');
const RejectedJob = require('../models/RejectedJob');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const rejections = await RejectedJob.find({ createdAt: { $gte: todayStart } }).sort({ score: -1 }).limit(10).lean();
    
    console.log(`Found ${rejections.length} rejected jobs today.`);
    for (const r of rejections) {
        console.log(`\nURL: ${r.applyLink}\nTitle: ${r.title}\nScore: ${r.score}\nReason: ${r.reason}\n`);
    }
    await mongoose.connection.close();
}
main();
