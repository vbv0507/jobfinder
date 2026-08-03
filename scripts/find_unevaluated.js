require('dotenv').config();
const mongoose = require('mongoose');
const RawJob = require('../models/RawJob');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const unevaluated = await RawJob.find({
        'sources.sourceChannel': { $exists: true, $ne: null }, 
        createdAt: { $gte: todayStart },
        aiEvaluated: false
    });
    
    console.log(`Found ${unevaluated.length} jobs.`);
    if (unevaluated.length > 0) {
        console.log('Sample job:', JSON.stringify(unevaluated[0], null, 2));
    }
    await mongoose.connection.close();
}
main();
