require('dotenv').config();
const mongoose = require('mongoose');
const { saveMatchedJob, saveRawJob } = require('../services/pipeline/storageService');
const Company = require('../models/Company');
const RawJob = require('../models/RawJob');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Get a real RawJob from today
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const rawJob = await RawJob.findOne({ 'sources.sourceChannel': { $exists: true, $ne: null }, createdAt: { $gte: todayStart } });
    if (!rawJob) { console.log('No raw job found'); return; }

    const company = await Company.findById(rawJob.company);
    const job = {
        title: rawJob.title,
        location: rawJob.location,
        experience: rawJob.experience,
        description: rawJob.description,
        applyLink: rawJob.applyLink,
        employmentType: rawJob.employmentType,
        jobId: rawJob.jobId
    };

    const analysis = {
        score: 30,
        confidence: 'Low',
        suitable: false,
        scoringBreakdown: { roleMatch: 0, skillsMatch: 0, experienceMatch: 0, domainMatch: 20, locationMatch: 0 },
        domainMismatch: false,
        domainExplanation: 'Candidate prefers backend domain',
        experienceMismatch: true,
        primaryReasons: ['Candidate lacks required experience'],
        reason: 'Candidate lacks required experience',
        missingSkills: ['Salesforce'],
        roleMatch: 'Weak',
        experienceMatch: 'Unknown',
        recommendation: 'Reject',
        evaluatedBy: 'Groq',
        provider: 'groq',
        model: 'llama',
        evaluationTimeMs: 1000,
        fallbackCount: 1,
        fallbackReason: 'Gemini failed',
        providerChain: ['Gemini', 'Groq']
    };

    console.log('Saving MatchedJob / RejectedJob...');
    try {
        const result = await saveMatchedJob(rawJob, company, job, analysis);
        console.log('Result:', result);
    } catch (err) {
        console.error('ERROR in saveMatchedJob:', err);
    }

    await mongoose.connection.close();
}

test().catch(err => {
    console.error('Outer error:', err);
    process.exit(1);
});
