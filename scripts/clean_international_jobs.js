require('dotenv').config();
const mongoose = require('mongoose');
require('../models/Company');
require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');
const RejectedJob = require('../models/RejectedJob');
const CacheManager = require('../services/cacheManager');

async function cleanInternationalJobs() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    const jobs = await MatchedJob.find({ status: 'new' }).populate('company');

    const internationalJobs = jobs.filter(j => {
        const loc = (j.location || '').toLowerCase();
        const isIndia = loc.includes('india') || loc.includes('bengaluru') || loc.includes('bangalore') || loc.includes('hyderabad') || loc.includes('pune') || loc.includes('delhi') || loc.includes('noida') || loc.includes('gurgaon') || loc.includes('mumbai') || loc.includes('chennai') || loc.includes('raipur');
        const isRemote = loc === 'remote' || loc.includes('remote - india') || loc.includes('india, remote');
        return !isIndia && !isRemote;
    });

    console.log(`Found ${internationalJobs.length} international jobs to clean from MatchedJobs:`);

    for (const j of internationalJobs) {
        console.log(` - Moving: "${j.role}" at ${j.company?.name || 'Company'} (Location: ${j.location}) to RejectedJobs...`);

        const rawJobId = j.rawJob?._id || j.rawJob;
        if (rawJobId) {
            await RejectedJob.findOneAndUpdate(
                { rawJob: rawJobId },
                {
                    $set: {
                        rawJob: rawJobId,
                        company: j.company?._id || j.company,
                        role: j.role,
                        location: j.location,
                        score: 30,
                        reason: `Location Mismatch: Role is located in ${j.location}, outside preferred candidate locations (India/Remote).`,
                        primaryReasons: [`Location Mismatch: Role is located in ${j.location}, outside preferred candidate locations (India/Remote).`],
                        recommendation: "Reject",
                        applyLink: j.applyLink,
                        evaluatedBy: j.evaluatedBy || "Location Filter",
                        provider: "location_filter",
                        verifiedAt: new Date(),
                        verificationStatus: "rejected"
                    }
                },
                { upsert: true }
            );
        }

        await MatchedJob.findByIdAndDelete(j._id);
    }

    CacheManager.invalidate();
    console.log("\nCache invalidated. Cleanup complete!");

    const remaining = await MatchedJob.countDocuments({ status: 'new' });
    console.log(`Remaining MatchedJobs: ${remaining}`);

    await mongoose.connection.close();
}

cleanInternationalJobs().catch(console.error);
