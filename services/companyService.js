const Company = require("../models/Company");
const companies = require("../utils/companies");

// Older seed entries keep matching rules with the scraper settings.  The
// pipeline, however, reads these rules from the Company document itself.
// Normalize them at the boundary so every seeded company is filtered the same
// way, without having to duplicate 72 sets of rules in utils/companies.js.
const normalizeSeedCompany = (company) => {
    const scraperConfig = company.scraperConfig || {};

    return {
        ...company,
        targetLocations: company.targetLocations?.length
            ? company.targetLocations
            : (scraperConfig.allowedLocations || []),
        targetKeywords: company.targetKeywords?.length
            ? company.targetKeywords
            : (scraperConfig.targetKeywords || []),
        excludedKeywords: company.excludedKeywords?.length
            ? company.excludedKeywords
            : (scraperConfig.excludedKeywords || []),
    };
};

const seedCompanies = async () => {
    const seedNames = new Set(companies.map(c => c.name));

    // 1. Upsert all companies from utils/companies.js
    for (const seedCompany of companies) {
        const company = normalizeSeedCompany(seedCompany);
        const updateDoc = {
            $set: { ...company, isSeedCompany: true }
        };

        // If no explicit adapter override in seed data, unset any stale adapter field from Mongo
        if (!company.adapter) {
            updateDoc.$unset = { adapter: "" };
        }

        await Company.findOneAndUpdate(
            { name: company.name },
            updateDoc,
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
    }

    // 2. Unset stale adapter overrides on all active seed companies
    await Company.updateMany(
        { 
            name: { $in: companies.filter(c => !c.adapter).map(c => c.name) },
            adapter: { $exists: true }
        },
        { $unset: { adapter: "" } }
    );

    // 3. Deactivate any unconfigured custom companies in DB that are not actively in seed
    const activeSeedNames = companies.filter(c => c.active !== false).map(c => c.name);
    await Company.updateMany(
        {
            name: { $nin: activeSeedNames },
            active: true
        },
        { $set: { active: false } }
    );

    console.log(`[Seed] Companies Seeded Successfully: ${companies.length} (${activeSeedNames.length} active)`);

    return companies.length;
};

module.exports = {
    seedCompanies
};
