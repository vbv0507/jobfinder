const express = require('express');
const { requireAdmin } = require('../middleware/authMiddleware');
const { getUsers, promoteUser, demoteUser, toggleUserStatus, grantViewAccess, revokeViewAccess } = require('../controllers/adminController');

const router = express.Router();

// All admin routes require admin privileges
router.use(requireAdmin);

// Views
router.get('/timeline', (req, res) => {
    res.render('admin/timeline', { title: "Pipeline Timeline" });
});

router.get('/ai', (req, res) => {
    res.render('admin/ai', { title: "AI Providers Dashboard" });
});

router.get('/config', (req, res) => {
    res.render('admin/config', { title: "Configuration Dashboard" });
});

router.get('/users', (req, res) => {
    res.render('admin/users', { title: "User Management" });
});

router.get('/scraper', (req, res) => {
    res.render('admin/scraper-diagnostics', { title: "Scraper Diagnostics" });
});

// APIs
router.get('/api/users', getUsers);
router.post('/api/users/:id/promote', promoteUser);
router.post('/api/users/:id/demote', demoteUser);
router.post('/api/users/:id/toggle', toggleUserStatus);
router.post('/api/users/:id/grant-access', grantViewAccess);
router.post('/api/users/:id/revoke-access', revokeViewAccess);

// Scraper Diagnostics APIs
const Company = require('../models/Company');
const SearchLog = require('../models/SearchLog');
router.get('/api/scraper/companies', async (req, res) => {
    try {
        const companies = await Company.find({}, 'name careerUrl scraperConfig healthScore successPercent runHistory').sort({ healthScore: 1 });
        res.json(companies);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



router.get('/api/scraper/export/json', async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(10);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/scraper/export/csv', async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(10);
        if (!logs.length) return res.send("No data");
        
        const header = ["createdAt", "companiesScanned", "companiesWithJobs", "companiesWithoutJobs", "parserOutdated", "atsChanged", "httpFailed", "jobsScraped", "jobsFound", "validationDrops", "duplicates", "jobsSaved"];
        const rows = logs.map(l => [
            l.createdAt, l.companiesScanned, l.companiesWithJobs, l.companiesWithoutJobs, l.parserOutdated, l.atsChanged, l.httpFailed, l.jobsScraped, l.jobsFound, l.validationDrops, l.duplicates, l.jobsSaved
        ].join(','));
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="diagnostics.csv"');
        res.send([header.join(','), ...rows].join('\n'));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/scraper/chart-data', async (req, res) => {
    try {
        const companies = await Company.find({}, 'name healthScore failureReason runHistory');
        const logs = await SearchLog.find().sort({ createdAt: 1 }).limit(30);
        
        // Build chart aggregations
        const failingCompanies = companies.filter(c => c.healthScore < 50).sort((a,b) => a.healthScore - b.healthScore).slice(0, 10);
        const healthDistribution = { Healthy: 0, Good: 0, Warning: 0, Critical: 0, Broken: 0 };
        companies.forEach(c => {
            if (c.healthScore >= 90) healthDistribution.Healthy++;
            else if (c.healthScore >= 70) healthDistribution.Good++;
            else if (c.healthScore >= 50) healthDistribution.Warning++;
            else if (c.healthScore >= 30) healthDistribution.Critical++;
            else healthDistribution.Broken++;
        });
        
        const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
        const validationDropsByReason = latestLog ? (latestLog.validationDropsByReason || {}) : {};

        res.json({ healthDistribution, logs, failingCompanies, validationDropsByReason });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
