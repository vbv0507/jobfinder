require('dotenv').config();
const mongoose = require('mongoose');
const { processJobUrl } = require('../services/telegramService');
const RawJob = require('../models/RawJob');
const Company = require('../models/Company');

async function testPipeline() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { getSkipReason, getActiveProfile } = require('../services/pipeline/aiEvaluationService');
    const profile = await getActiveProfile();
    
    let rawJob = null;
    const allUnevaluated = await RawJob.find({ 'sources.sourceChannel': { $exists: true, $ne: null }, createdAt: { $gte: todayStart }, aiEvaluated: false });
    for (const job of allUnevaluated) {
        if (!getSkipReason(job, profile)) {
            rawJob = job;
            break;
        }
    }
    
    if (!rawJob) {
        console.log("No unevaluated job found.");
        return;
    }

    const company = await Company.findById(rawJob.company);
    
    const structuredData = {
        company: rawJob.companyName || company.name,
        role: rawJob.title,
        location: rawJob.location,
        experience: rawJob.experience
    };

    console.log("Profile is null?", profile === null);
    if (profile) console.log("Profile preferredLocations:", profile.preferredLocations);

    console.log("Running processJobUrl for:", rawJob.applyLink);
    const result = await processJobUrl(rawJob.applyLink, company, profile, structuredData, "testChannel", "1234");

    
    console.log("Result:", result);
    await mongoose.connection.close();
}

testPipeline().catch(console.error);
