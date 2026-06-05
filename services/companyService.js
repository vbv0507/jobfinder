const Company = require("../models/Company");
const companies = require("../utils/companies");

const seedCompanies = async () => {
    // Keep MongoDB in sync with utils/companies.js.
    // This removes old HTML-scraper companies from previous versions of the project.
    await Company.deleteMany({});

    await Company.insertMany(companies);

    console.log(`Companies Seeded Successfully: ${companies.length}`);

    return companies.length;
};

module.exports = {
    seedCompanies
};
