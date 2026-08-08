const Company = require("../models/Company");
const { seedCompanies } = require("../services/companyService");
const { logAuditAction } = require("../services/auditService");
const seedCompanyNames = new Set(require("../utils/companies").map((company) => company.name));


const addCompany = async (req, res) => {
    try {
        const company = await Company.create({ ...req.body, isSeedCompany: false });
        await logAuditAction(req, 'Company Edit', `Added ${company.name}`);
        const socketService = require("../services/socketService");
        socketService.emitCompanySnapshot().catch(error => console.error("[Socket] Failed to emit companies:update:", error.message));

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
        const filter = {};
        if (req.query.seedOnly === 'true' || req.query.view === 'seed') {
            filter.$or = [
                { isSeedCompany: true },
                { name: { $in: [...seedCompanyNames] } }
            ];
        }

        const companies = await Company.find(filter).lean();
        const { getCompanyLogo } = require("../utils/companyBranding");

        const companiesWithLogos = companies.map(c => ({
            ...c,
            logoUrl: c.logo || getCompanyLogo(c.name)
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
        await logAuditAction(req, 'Company Edit', `Seeded ${companies.length} companies`);
        const socketService = require("../services/socketService");
        socketService.emitCompanySnapshot().catch(error => console.error("[Socket] Failed to emit companies:update:", error.message));

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
