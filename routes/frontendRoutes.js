const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const router = express.Router();

router.use(requireAuth);

router.get('/pipeline', (req, res) => {
    res.render('pages/pipeline', { title: 'Pipeline Execution' });
});

router.get('/discovery', (req, res) => {
    res.render('pages/ats-discovery', { title: 'ATS Discovery Engine' });
});

router.get('/cache', (req, res) => {
    res.render('pages/cache-dashboard', { title: 'Smart Cache' });
});

router.get('/ai-dashboard', (req, res) => {
    res.render('pages/ai-dashboard', { title: 'AI Evaluation' });
});

router.get('/logs', (req, res) => {
    res.render('pages/logs', { title: 'Runtime Logs' });
});

router.get('/telegram-dashboard', (req, res) => {
    res.render('pages/telegram-dashboard', { title: 'Telegram Monitoring' });
});

router.get('/evidence', (req, res) => {
    res.render('pages/evidence', { title: 'Evidence Viewer' });
});

module.exports = router;
