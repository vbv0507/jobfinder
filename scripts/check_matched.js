require('dotenv').config();
const mongoose = require('mongoose');
const MatchedJob = require('../models/MatchedJob');
async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const count = await MatchedJob.countDocuments({ createdAt: { $gte: todayStart } });
    console.log('MatchedJobs today:', count);
    await mongoose.connection.close();
}
main();
