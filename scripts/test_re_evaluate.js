require('dotenv').config();
const mongoose = require('mongoose');
const RejectedJob = require('../models/RejectedJob');
const RawJob = require('../models/RawJob');
const Company = require('../models/Company');
const { evaluateJob } = require('../services/geminiService');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const rejections = await RejectedJob.find({ createdAt: { $gte: todayStart } }).lean();
    
    console.log(`Found ${rejections.length} rejected jobs to re-evaluate.`);
    const { getActiveProfile } = require('../services/pipeline/aiEvaluationService');
    const profile = await getActiveProfile();

    let matchedCount = 0;
    
    for (const r of rejections.slice(0, 5)) { // Test first 5
        console.log(`Re-evaluating: ${r.applyLink}`);
        const rawJob = await RawJob.findById(r.rawJob);
        if(!rawJob) continue;
        const company = await Company.findById(rawJob.company);
        
        const structuredData = {
            company: rawJob.companyName || (company ? company.name : "Unknown"),
            role: rawJob.title,
            location: rawJob.location,
            experience: rawJob.experience
        };
        
        try {
            const aiState = { gemini: { available: true }, groq: { available: true }, local: {} };
            const result = await evaluateJob(rawJob, profile, aiState);
            console.log(`New Score: ${result.score} (Suitable: ${result.suitable})`);
            if (result.suitable) matchedCount++;
        } catch (e) {
            console.error(e);
        }
    }
    
    console.log(`Matched ${matchedCount} jobs out of 5 tested.`);
    await mongoose.connection.close();
}

main().catch(console.error);
