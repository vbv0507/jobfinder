const mongoose = require('mongoose');
const MatchedJob = require('../models/MatchedJob');
const RejectedJob = require('../models/RejectedJob');
const RawJob = require('../models/RawJob');

require('dotenv').config();

async function repairIndexes() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB.");

        try {
            await MatchedJob.collection.dropIndex("rawJob_1");
            console.log("Dropped rawJob_1 from MatchedJobs");
        } catch (e) {
            console.log("Could not drop rawJob_1 from MatchedJobs (may not exist).", e.message);
        }

        try {
            await RejectedJob.collection.dropIndex("rawJob_1");
            console.log("Dropped rawJob_1 from RejectedJobs");
        } catch (e) {
            console.log("Could not drop rawJob_1 from RejectedJobs (may not exist).", e.message);
        }

        try {
            await RawJob.collection.dropIndex("company_1_jobId_1");
            console.log("Dropped company_1_jobId_1 from RawJobs");
        } catch (e) {
            console.log("Could not drop company_1_jobId_1 from RawJobs (may not exist).", e.message);
        }

        console.log("Rebuilding indexes...");
        await MatchedJob.syncIndexes();
        await RejectedJob.syncIndexes();
        await RawJob.syncIndexes();
        console.log("Indexes synced successfully.");
    } catch (err) {
        console.error("Error repairing indexes:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

repairIndexes();
