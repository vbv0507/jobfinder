require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const seedCompanies = require('../utils/companies');

async function syncSeedCompanies() {
  console.log('[Sync] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[Sync] Connected to MongoDB.');

  const activeSeeds = seedCompanies.filter(c => c.active !== false);
  console.log(`[Sync] Found ${activeSeeds.length} active seeded companies in utils/companies.js`);

  let updated = 0;
  let created = 0;

  for (const seed of activeSeeds) {
    const filter = { name: seed.name };
    const update = {
      $set: {
        name: seed.name,
        category: seed.category || 'Product',
        industry: seed.industry || 'Technology',
        ats: seed.ats || 'custom',
        active: true,
        careerUrl: seed.careerUrl || seed.careerPage,
        careerPage: seed.careerPage || seed.careerUrl,
        logo: seed.logo || `https://logo.clearbit.com/${seed.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        scraperType: seed.scraperType || 'api',
        scraperConfig: seed.scraperConfig || {},
        targetKeywords: seed.targetKeywords || seed.scraperConfig?.targetKeywords || [],
        excludedKeywords: seed.excludedKeywords || seed.scraperConfig?.excludedKeywords || [],
        targetLocations: seed.targetLocations || seed.scraperConfig?.allowedLocations || [],
        isSeedCompany: true,
      }
    };

    const res = await Company.updateOne(filter, update, { upsert: true });
    if (res.upsertedCount > 0) created++;
    else if (res.modifiedCount > 0) updated++;
  }

  console.log(`[Sync] Complete. Created: ${created}, Updated: ${updated}, Total Active in DB: ${await Company.countDocuments({ active: true })}`);
  await mongoose.disconnect();
}

syncSeedCompanies().catch(err => {
  console.error('[Sync] Error syncing companies:', err);
  process.exit(1);
});
