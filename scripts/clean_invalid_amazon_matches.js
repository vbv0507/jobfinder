require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const MatchedJob = require('../models/MatchedJob');
const RawJob = require('../models/RawJob');
const RejectedJob = require('../models/RejectedJob');
const Company = require('../models/Company');
const { invalidateAnalyticsCache } = require('../services/analyticsService');

async function cleanAmazonMatches() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Clean Amazon] Connected to MongoDB');

  const amazon = await Company.findOne({ name: 'Amazon' });
  if (!amazon) {
    console.error('Amazon company not found in database');
    process.exit(1);
  }

  const amazonMatches = await MatchedJob.find({ company: amazon._id }).populate('rawJob');
  console.log(`Found ${amazonMatches.length} Amazon matched jobs to inspect.`);

  for (const match of amazonMatches) {
    console.log(`\nInspecting: "${match.role}" (ID: ${match._id})`);
    console.log(`Apply Link: ${match.applyLink}`);

    // Extract Amazon Job ID (digits)
    const idMatch = match.applyLink.match(/\/jobs\/(\d+)\//);
    const amazonJobId = idMatch ? idMatch[1] : '';

    let basicQuals = '';
    let preferredQuals = '';
    let mainDesc = '';

    if (amazonJobId) {
      try {
        const res = await axios.get(`https://www.amazon.jobs/en/search.json?query=${amazonJobId}`);
        const jobData = res.data?.jobs?.[0];
        if (jobData) {
          basicQuals = (jobData.basic_qualifications || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          preferredQuals = (jobData.preferred_qualifications || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          mainDesc = (jobData.description || jobData.description_short || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      } catch (err) {
        console.warn(`Could not query Amazon API for ID ${amazonJobId}: ${err.message}`);
      }
    }

    const fullDescription = [
      mainDesc || match.rawJob?.description || '',
      basicQuals ? `Basic Qualifications:\n${basicQuals}` : '',
      preferredQuals ? `Preferred Qualifications:\n${preferredQuals}` : ''
    ].filter(Boolean).join('\n\n');

    const expMatch = basicQuals.match(/(\d+)\+?\s*years?\s*(?:of)?\s*(?:non-internship|professional|software|development|engineering|industry)?/i);
    const requiredYears = expMatch ? `${expMatch[1]}+ years` : '3+ years';

    console.log(`Detected Experience Requirement: ${requiredYears}`);

    // 1. Update RawJob with full description and experience
    if (match.rawJob) {
      await RawJob.findByIdAndUpdate(match.rawJob._id, {
        $set: {
          description: fullDescription,
          experience: requiredYears,
          aiMatched: false,
          aiEvaluated: true,
          aiEvaluatedAt: new Date()
        }
      });
      console.log(`Updated RawJob ${match.rawJob._id} with full description & experience.`);
    }

    // 2. Insert into RejectedJob
    const rejectionReason = `Requires ${requiredYears} of non-internship professional software development experience (candidate is a 2027 fresher with 0 years experience).`;
    await RejectedJob.findOneAndUpdate(
      { applyLink: match.applyLink },
      {
        $set: {
          role: match.role,
          company: amazon._id,
          applyLink: match.applyLink,
          reason: rejectionReason,
          validationStage: 'Experience',
          validator: 'hasAllowedExperience',
          score: 20,
          rawJob: match.rawJob?._id,
          lastScrapedAt: new Date()
        }
      },
      { upsert: true }
    );
    console.log(`Moved to RejectedJob: "${rejectionReason}"`);

    // 3. Remove from MatchedJob
    await MatchedJob.findByIdAndDelete(match._id);
    console.log(`Removed MatchedJob ${match._id}.`);
  }

  // Clear cache
  invalidateAnalyticsCache();
  console.log('\n[Clean Amazon] Successfully cleaned invalid Amazon matches & invalidated cache.');
  process.exit(0);
}

cleanAmazonMatches().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
