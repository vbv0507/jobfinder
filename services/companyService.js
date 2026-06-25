const Company = require("../models/Company");
const companies = require("../utils/companies");

const seedCompanies = async () => {
    // Keep MongoDB in sync without changing existing _id values.
    // RawJob and MatchedJob store company ObjectIds, so deleting companies
    // would make older jobs lose their company name after populate().
    await Promise.all(
        companies.map((company) =>
            Company.findOneAndUpdate(
                { name: company.name },
                { $set: company },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ),
        ),
    );

    console.log(`Companies Seeded Successfully: ${companies.length}`);

    return companies.length;
};

module.exports = {
    seedCompanies
};
