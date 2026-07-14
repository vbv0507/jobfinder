const Company = require("../models/Company");
const companies = require("../utils/companies");

const seedCompanies = async () => {
    
    
    
    await Promise.all(
        companies.map((company) =>
            Company.findOneAndUpdate(
                { name: company.name },
                { $set: company },
                { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
            ),
        ),
    );

    console.log(`Companies Seeded Successfully: ${companies.length}`);

    return companies.length;
};

module.exports = {
    seedCompanies
};
