require('dotenv').config();
const mongoose = require('mongoose');
const RawJob = require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');

const migrateLinks = async (Model, modelName) => {
    console.log(`\nStarting migration for ${modelName}...`);
    const jobs = await Model.find({});
    
    let deletedCount = 0;
    for (const job of jobs) {
        if (!job.applyLink) continue;
        
        const link = job.applyLink.toLowerCase();
        
        const invalidSubstrings = ['undefined', '//job/', 'samecorp', 'example', 'localhost', 'error=true', 'null'];
        
        if (invalidSubstrings.some(sub => link.includes(sub))) {
            console.log(`[DELETED] Dummy/Broken URL detected: ${job.applyLink}`);
            await Model.deleteOne({ _id: job._id });
            deletedCount++;
        }
    }
    console.log(`Finished ${modelName}. Deleted ${deletedCount} records.`);
};

const runMigration = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB.");
        
        await migrateLinks(RawJob, 'RawJob');
        await migrateLinks(MatchedJob, 'MatchedJob');
        
        console.log("Migration complete.");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
};

runMigration();
