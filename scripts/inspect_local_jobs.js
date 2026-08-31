require('dotenv').config();
const mongoose = require('mongoose');
const MatchedJob = require('../models/MatchedJob');
const RawJob = require('../models/RawJob');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Group all matched jobs by provider
    const allMatched = await MatchedJob.find({});
    const providerCounts = {};
    allMatched.forEach(j => {
        const p = j.provider || (j.evaluatedBy ? `by_${j.evaluatedBy}` : 'none');
        providerCounts[p] = (providerCounts[p] || 0) + 1;
    });
    console.log("MatchedJobs Provider Breakdown:", providerCounts);

    const localJobs = await MatchedJob.find({
        $or: [
            { provider: { $regex: /local/i } },
            { provider: 'unknown' },
            { provider: { $exists: false } },
            { provider: null },
            { evaluatedBy: { $regex: /local/i } }
        ]
    });

    let withExistingRaw = 0;
    let withoutRaw = 0;
    const samples = [];

    for (const j of localJobs) {
        if (j.rawJob) {
            const raw = await RawJob.findById(j.rawJob);
            if (raw && (raw.description || raw.title)) {
                withExistingRaw++;
                if (samples.length < 3) samples.push({ matched: j, raw });
                continue;
            }
        }
        withoutRaw++;
        if (samples.length < 3) samples.push({ matched: j, raw: null });
    }

    console.log(`With valid RawJob: ${withExistingRaw}, Without RawJob: ${withoutRaw}`);
    console.log("\nSamples:");
    samples.forEach(s => {
        console.log({
            matchedId: s.matched._id,
            role: s.matched.role,
            location: s.matched.location,
            score: s.matched.score,
            provider: s.matched.provider,
            evaluatedBy: s.matched.evaluatedBy,
            rawJobId: s.matched.rawJob,
            hasRawContent: !!s.raw,
            rawDescSnippet: s.raw?.description ? s.raw.description.substring(0, 100) : 'N/A'
        });
    });

    await mongoose.connection.close();
}

main().catch(console.error);
