require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const AdapterFactory = require('../services/ats/AdapterFactory');
const { hasExcludedKeyword, hasTargetKeyword, hasAllowedLocation } = require('../services/pipeline/validationService');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const targetCompanies = ["NVIDIA", "Anthropic", "Adobe", "American Express", "Scale AI", "PayPal", "Visa", "Mastercard"];
  const dbTargetCompanies = await Company.find({ name: { $in: targetCompanies } }); // NO .lean()!

  for (const company of dbTargetCompanies) {
    console.log(`\nFetching jobs for ${company.name}...`);
    try {
      const adapter = AdapterFactory.getAdapter(company);
      const jobs = await adapter.searchJobs();
      console.log(`Parsed ${jobs.length} raw jobs for ${company.name}`);
      
      let usJobCount = 0;
      let rejectedLocationCount = 0;
      
      for (const job of jobs) {
        const locationCheck = hasAllowedLocation(job, company);
        if (!locationCheck.passed) {
          rejectedLocationCount++;
          if (rejectedLocationCount <= 3) {
             console.log(`Rejected:`);
             console.log(`Company: ${company.name}`);
             console.log(`Title: ${job.title}`);
             console.log(`Location: ${job.location}`);
             console.log(`Reason: hasAllowedLocation`);
             console.log(`Allowed Locations: ${JSON.stringify(company.targetLocations)}`);
             console.log(`Incoming location: "${job.location}"`);
             console.log(`Result: false`);
             console.log(`----------------------------------`);
          }
        }
      }
      console.log(`Total Rejected by Location for ${company.name}: ${rejectedLocationCount}`);

    } catch (e) {
      console.error(`Failed for ${company.name}: ${e.message}`);
    }
  }
  mongoose.disconnect();
}
run();
