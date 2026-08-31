require('dotenv').config();
const mongoose = require('mongoose');
const MatchedJob = require('../models/MatchedJob');
const Company = require('../models/Company');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    const jobs = await MatchedJob.find({ status: 'new' }).populate('company').sort({ score: -1 });

    console.log(`Total MatchedJobs in DB: ${jobs.length}\n`);
    jobs.forEach((j, i) => {
        console.log(`[${i + 1}] ${j.role} at ${j.company?.name || 'Unknown'}`);
        console.log(`    Location: ${j.location}`);
        console.log(`    Score: ${j.score}/100 | Provider: ${j.provider || j.evaluatedBy}`);
        console.log(`    Apply: ${j.applyLink}`);
        console.log('---');
    });

    await mongoose.connection.close();
}

main().catch(console.error);
