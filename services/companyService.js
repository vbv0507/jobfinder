const Company = require("../models/Company");
const companies = require("../utils/companies");

const seedCompanies = async () => {
    const seedNames = new Set(companies.map(c => c.name));

    // 1. Upsert all companies from utils/companies.js
    for (const company of companies) {
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
