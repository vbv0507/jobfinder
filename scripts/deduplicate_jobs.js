require('dotenv').config();
const mongoose = require('mongoose');
const RawJob = require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected for deduplication');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
}

function normalizeJobId(jobId) {
    if (!jobId || jobId.toLowerCase() === 'unknown') return 'unknown';
    return jobId.trim().toLowerCase();
}

function normalizeApplyLink(link) {
    if (!link) return '';
    try {
        const url = new URL(link);
        
        url.search = '';
        url.hash = '';
        let normalized = url.toString().toLowerCase();
        
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    } catch (e) {
        return link.trim().toLowerCase();
    }
}

async function deduplicate() {
    await connectDB();
    console.log('Starting deduplication process...');

    const rawJobs = await RawJob.find({});
    console.log(`Total RawJobs found: ${rawJobs.length}`);

    
    
    const groups = new Map();

    for (const job of rawJobs) {
        const companyId = job.company ? job.company.toString() : 'nocompany';
        let jobId = normalizeJobId(job.jobId);
        let applyLink = normalizeApplyLink(job.applyLink);

        
        
        job.jobId = jobId;
        await job.save();

        let key;
        if (jobId === 'unknown') {
            key = `${companyId}_link_${applyLink}`;
        } else {
            key = `${companyId}_id_${jobId}`;
        }

        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(job);
    }

    let duplicateGroupsFound = 0;
    let jobsRemoved = 0;
    let matchedJobsRemoved = 0;

    for (const [key, group] of groups.entries()) {
        if (group.length > 1) {
            duplicateGroupsFound++;
            console.log(`\nDuplicate group found for key: ${key} (Count: ${group.length})`);
            
            
            
            group.sort((a, b) => {
                const aSources = a.sources ? a.sources.length : 0;
                const bSources = b.sources ? b.sources.length : 0;
                if (aSources !== bSources) return bSources - aSources;
                return (b.scrapedAt || b.createdAt) - (a.scrapedAt || a.createdAt);
            });

            const keepJob = group[0];
            const removeJobs = group.slice(1);

            console.log(`  Keeping Job: ${keepJob._id} | Title: ${keepJob.title}`);

            
            if (keepJob.sources) {
                const keepSourceChannels = new Set(keepJob.sources.map(s => s.sourceChannel));
                for (const rJob of removeJobs) {
                    if (rJob.sources) {
                        for (const source of rJob.sources) {
                            if (!keepSourceChannels.has(source.sourceChannel)) {
                                keepJob.sources.push(source);
                                keepSourceChannels.add(source.sourceChannel);
                            }
                        }
                    }
                }
                await keepJob.save();
            }

            
            for (const rJob of removeJobs) {
                console.log(`  Removing duplicate Job: ${rJob._id}`);
                await RawJob.findByIdAndDelete(rJob._id);
                jobsRemoved++;

                
                const matchedResult = await MatchedJob.deleteMany({ rawJob: rJob._id });
                if (matchedResult.deletedCount > 0) {
                    console.log(`    Also removed ${matchedResult.deletedCount} MatchedJob(s) for this duplicate.`);
                    matchedJobsRemoved += matchedResult.deletedCount;
                }
            }
        }
    }

    console.log(`\nDeduplication completed.`);
    console.log(`Duplicate groups found: ${duplicateGroupsFound}`);
    console.log(`RawJobs removed: ${jobsRemoved}`);
    console.log(`MatchedJobs removed: ${matchedJobsRemoved}`);

    mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
}

deduplicate().catch(console.error);
