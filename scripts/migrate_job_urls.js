require('dotenv').config();
const mongoose = require('mongoose');
const RawJob = require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');
const Company = require('../models/Company');

const fixWorkdayLink = (link, company) => {
    if (!link.includes('//job/')) return link;
    if (!company || !company.scraperConfig || !company.scraperConfig.apiUrl) return link;
    
    const config = company.scraperConfig;
    const match = config.apiUrl.match(/https:\/\/(.+?)\/wday\/cxs\/[^\/]+\/([^\/]+)/);
    if (!match) return link;
    
    const base = `https://${match[1]}/en-US/${match[2]}`;
    const externalPath = link.substring(link.indexOf('/job/'));
    return `${base}${externalPath}`;
};

const fixSmartRecruitersLink = (link) => {
    if (!link.includes('api.smartrecruiters.com')) return link;
    
    const match = link.match(/companies\/([^\/]+)\/postings\/(.+)/);
    if (!match) return link;
    
    return `https://jobs.smartrecruiters.com/${match[1]}/${match[2]}`;
};

const migrateLinks = async (Model, modelName) => {
    console.log(`\nStarting migration for ${modelName}...`);
    const jobs = await Model.find({}).populate('company');
    
    let updatedCount = 0;
    for (const job of jobs) {
        if (!job.applyLink) continue;
        
        let originalLink = job.applyLink;
        let newLink = originalLink;
        
        if (newLink.includes('//job/')) {
            newLink = fixWorkdayLink(newLink, job.company);
        }
        
        if (newLink.includes('api.smartrecruiters.com')) {
            newLink = fixSmartRecruitersLink(newLink);
        }
        
        if (originalLink !== newLink) {
            console.log(`[FIXED] ${originalLink} -> ${newLink}`);
            job.applyLink = newLink;
            await job.save();
            updatedCount++;
        } else if (!newLink.startsWith('https://') || newLink.includes('undefined')) {
            console.log(`[DELETED] Malformed URL cannot be fixed: ${newLink}`);
            await Model.deleteOne({ _id: job._id });
            updatedCount++;
        }
    }
    console.log(`Finished ${modelName}. Updated/Deleted ${updatedCount} records.`);
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
