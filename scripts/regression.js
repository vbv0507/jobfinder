require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const AdapterFactory = require('../services/ats/AdapterFactory');
const { applyJobFilters } = require('../services/pipeline/validationService');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const targetCompanies = ["Anthropic", "NVIDIA", "Adobe", "American Express", "Scale AI", "PayPal", "Visa", "Mastercard"];
  const dbTargetCompanies = await Company.find({ name: { $in: targetCompanies } });

  console.log("\n===========================");
  console.log("PHASE 5 — REGRESSION TEST");
  console.log("===========================");

  for (const company of dbTargetCompanies) {
    try {
      const adapter = AdapterFactory.getAdapter(company);
      const jobs = await adapter.searchJobs();
      
      const droppedJobs = [];
      const validJobs = applyJobFilters(jobs, company, droppedJobs);
      
      const parsed = jobs.length;
      const validated = validJobs.length;
      
      console.log(`\n--- ${company.name} ---`);
      console.log(`Parsed Jobs:    ${parsed}`);
      console.log(`Validated Jobs: ${validated} (${parsed ? ((validated/parsed)*100).toFixed(1) : 0}%)`);
      console.log(`Rejected:       ${parsed - validated} (${parsed ? (((parsed - validated)/parsed)*100).toFixed(1) : 0}%)`);
      
    } catch (e) {
      console.error(`\n--- ${company.name} ---`);
      console.error(`Failed: ${e.message}`);
    }
  }

  mongoose.disconnect();
}

run();
