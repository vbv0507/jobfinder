const express = require('express');
const { requireAdmin } = require('../middleware/authMiddleware');
const { getUsers, promoteUser, demoteUser, toggleUserStatus } = require('../controller/adminController');

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

// APIs
router.get('/api/users', getUsers);
router.post('/api/users/:id/promote', promoteUser);
router.post('/api/users/:id/demote', demoteUser);
router.post('/api/users/:id/toggle', toggleUserStatus);

module.exports = router;
