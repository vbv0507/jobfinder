require('dotenv').config();
const mongoose = require('mongoose');
const RawJob = require('../models/RawJob');

async function main() {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const evaluatedCount = await RawJob.countDocuments({
        'sources.sourceChannel': { $exists: true, $ne: null }, 
        createdAt: { $gte: todayStart },
        aiEvaluated: true
    });
    const notEvaluatedCount = await RawJob.countDocuments({
        'sources.sourceChannel': { $exists: true, $ne: null }, 
        createdAt: { $gte: todayStart },
        aiEvaluated: false
    });
    
    console.log('aiEvaluated=true:', evaluatedCount);
    console.log('aiEvaluated=false:', notEvaluatedCount);
    await mongoose.connection.close();
}
main().catch(e => { console.error(e); process.exit(1); });
