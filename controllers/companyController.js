const Company = require("../models/Company");
const { seedCompanies } = require("../services/companyService");
const { logAuditAction } = require("../services/auditService");
const AdapterFactory = require("../services/ats/AdapterFactory");
const { saveRawJob } = require("../services/pipeline/storageService");
const { getCompanyLogo } = require("../utils/companyBranding");
const { sendNotFound, sendServerError } = require("../utils/controllerResponses");
const { emitCompanySnapshot, refreshCompanyViews } = require("../services/companyViewService");
const seedCompanyNames = new Set(require("../utils/companies").map((company) => company.name));


const addCompany = async (req, res) => {
    try {
        const company = await Company.create({ ...req.body, isSeedCompany: false });
        await logAuditAction(req, 'Company Edit', `Added ${company.name}`);
        emitCompanySnapshot("[Socket] Failed to emit companies:update:");

        res.status(201).json({
            success: true,
            company,
        });
    } catch (error) {
        sendServerError(res, error);
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
        sendServerError(res, error);
    }
};


const seedCompanyList = async (req, res) => {
    try {
        await seedCompanies();
        const companies = await Company.find();
        await logAuditAction(req, 'Company Edit', `Seeded ${companies.length} companies`);
        emitCompanySnapshot("[Socket] Failed to emit companies:update:");

        res.status(200).json({
            success: true,
            message: "Companies seeded successfully",
            count: companies.length,
            companies,
        });
    } catch (error) {
        sendServerError(res, error);
    }
};

const toggleCompanyStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const company = await Company.findById(id);
        if (!company) {
            return sendNotFound(res, "Company not found");
        }

        company.active = req.body.active !== undefined ? req.body.active : !company.active;
        await company.save();

        await logAuditAction(req, 'Company Status Toggle', `${company.name} set to ${company.active ? 'Active' : 'Inactive'}`);

        refreshCompanyViews("[Socket] Update error:");

        res.status(200).json({
            success: true,
            message: `${company.name} is now ${company.active ? 'active' : 'inactive'}`,
            company
        });
    } catch (error) {
        sendServerError(res, error);
    }
};

const scrapeCompanyDirectly = async (req, res) => {
    try {
        const { id } = req.params;
        const company = await Company.findById(id);
        if (!company) {
            return sendNotFound(res, "Company not found");
        }

        const adapter = AdapterFactory.getAdapter(company);
        const startTime = Date.now();
        const rawJobs = await adapter.searchJobs();
        const durationMs = Date.now() - startTime;

        let savedCount = 0;
        for (const job of rawJobs) {
            const saved = await saveRawJob(company, job);
            if (saved) savedCount++;
        }

        // Update company scrape metadata in MongoDB
        company.lastScrapedAt = new Date();
        company.lastScrapeStatus = rawJobs.length > 0 ? 'success' : 'failed';
        company.jobsFound = rawJobs.length;
        await company.save();

        refreshCompanyViews("[Socket] Snapshot error:");

        res.status(200).json({
            success: true,
            company: company.name,
            ats: adapter.parserName || company.ats,
            rawJobsFound: rawJobs.length,
            savedCount,
            durationMs
        });
    } catch (error) {
        try {
            await Company.findByIdAndUpdate(req.params.id, {
                lastScrapedAt: new Date(),
                lastScrapeStatus: 'failed'
            });
        } catch (_) {}
        sendServerError(res, error);
    }
};

module.exports = {
    addCompany,
    getCompanies,
    seedCompanyList,
    toggleCompanyStatus,
    scrapeCompanyDirectly
};
