const express = require('express');
const router = express.Router();

router.get('/timeline', (req, res) => {
    res.render('admin/timeline', { title: "Pipeline Timeline" });
});

router.get('/ai', (req, res) => {
    res.render('admin/ai', { title: "AI Providers Dashboard" });
});

router.get('/config', (req, res) => {
    res.render('admin/config', { title: "Configuration Dashboard" });
});

module.exports = router;
