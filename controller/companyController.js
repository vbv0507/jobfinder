const Company = require("../models/Company");
const { seedCompanies } = require("../services/companyService");

// Add one company manually from Postman/API.
const addCompany = async (req, res) => {
    try {
        const company = await Company.create(req.body);

        res.status(201).json({
            success: true,
            company,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// Show all companies stored in MongoDB.
const getCompanies = async (req, res) => {
    try {
        const companies = await Company.find();

        res.status(200).json({
            success: true,
            count: companies.length,
            companies,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// Reset company collection using utils/companies.js.
const seedCompanyList = async (req, res) => {
    try {
        await seedCompanies();
        const companies = await Company.find();

        res.status(200).json({
            success: true,
            message: "Companies seeded successfully",
            count: companies.length,
            companies,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

module.exports = {
    addCompany,
    getCompanies,
    seedCompanyList,
};
