const Company = require("../models/Company");
const { seedCompanies } = require("../services/companyService");


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


const getCompanies = async (req, res) => {
    try {
        const companies = await Company.find().lean();
        const { getCompanyLogo } = require("../utils/companyBranding");

        const companiesWithLogos = companies.map(c => ({
            ...c,
            logoUrl: getCompanyLogo(c.name)
        }));

        res.status(200).json({
            success: true,
            count: companiesWithLogos.length,
            companies: companiesWithLogos,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


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
