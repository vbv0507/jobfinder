const express = require('express');
const { requireAdmin, requireSuperAdmin, requireViewer } = require('../middleware/authMiddleware');
const { getUsers, promoteUser, demoteUser, toggleUserStatus, grantViewAccess, revokeViewAccess } = require('../controllers/adminController');
const { logAuditAction } = require('../services/auditService');
const scraperDiagnostics = require('../controllers/scraperDiagnosticsController');

const router = express.Router();

// Viewer self-service access request. This must stay before the admin gate.
router.post('/api/users/request-access', requireViewer, async (req, res) => {
    try {
        if (req.user.role === 'admin' || req.user.viewAccess === 'granted') {
            return res.json({ success: true, message: 'Extended view access is already granted.' });
        }

        if (req.user.viewAccess !== 'requested') {
            req.user.viewAccess = 'requested';
            await req.user.save();
            await logAuditAction(req, 'Request View Access', `Requested extended view access for ${req.user.email}`);
        }

        res.json({ success: true, message: 'Access request submitted.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// All admin routes require authenticated privileges
router.use(requireAdmin);

// Views
router.get('/timeline', (req, res) => {
    res.render('admin/timeline', { title: "Pipeline Timeline" });
});

router.get('/ai', (req, res) => {
    res.render('admin/ai', { title: "AI Providers Dashboard" });
});

router.get('/config', requireSuperAdmin, (req, res) => {
    res.render('admin/config', { title: "Configuration Dashboard" });
});

router.get('/users', requireSuperAdmin, (req, res) => {
    res.render('admin/users', { title: "User Management" });
});

router.get('/scraper', (req, res) => {
    res.render('admin/scraper-diagnostics', { title: "Scraper Diagnostics" });
});

// User Management APIs (Super-Admin only: vbvrai1407)
router.get('/api/users', requireSuperAdmin, getUsers);
router.post('/api/users/:id/promote', requireSuperAdmin, promoteUser);
router.post('/api/users/:id/demote', requireSuperAdmin, demoteUser);
router.post('/api/users/:id/toggle', requireSuperAdmin, toggleUserStatus);
router.post('/api/users/:id/grant-access', requireSuperAdmin, grantViewAccess);
router.post('/api/users/:id/revoke-access', requireSuperAdmin, revokeViewAccess);

// Scraper Diagnostics APIs
router.get('/api/scraper/companies', scraperDiagnostics.getCompanies);
router.get('/api/scraper/export/json', scraperDiagnostics.exportJson);
router.get('/api/scraper/export/csv', scraperDiagnostics.exportCsv);
router.get('/api/scraper/chart-data', scraperDiagnostics.getChartData);

module.exports = router;
