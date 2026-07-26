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

router.get('/ai-rejected', async (req, res) => {
    try {
        const RejectedJob = require('../models/RejectedJob');
        const jobs = await RejectedJob.find().populate('company', 'name').sort({ createdAt: -1 });
        res.render('pages/rejected-jobs', { jobs, title: 'AI Rejected Jobs' });
    } catch(e) {
        res.render('pages/rejected-jobs', { jobs: [], title: 'AI Rejected Jobs' });
    }
});

router.get('/', async (req, res, next) => {
    try {
        const CandidateProfile = require('../models/CandidateProfile');
        const hasProfile = await CandidateProfile.exists({ user: req.user._id });
        
        console.log(`[Root Route] UserId: ${req.user._id} | SessionId: ${req.auth?.sessionId || 'N/A'} | Email: ${req.user.email} | DBUserExists: true | CandidateProfileExists: ${!!hasProfile} | RenderPath: index`);
        
        res.render('pages/dashboard');
    } catch (error) {
        console.error(`[Root Route] Exception in GET /:`, error.stack);
        next(error);
    }
});

router.get('/jobs', async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'new' }).populate('company', 'name').sort({ score: -1 });
        res.render('pages/jobs', { jobs, title: 'Matched Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Matched Jobs' });
    }
});

router.get('/saved', async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'saved' }).populate('company', 'name').sort({ score: -1 });
        res.render('pages/jobs', { jobs, title: 'Saved Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Saved Jobs' });
    }
});

router.get('/applied', async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'applied' }).populate('company', 'name').sort({ appliedAt: -1 });
        res.render('pages/jobs', { jobs, title: 'Applied Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Applied Jobs' });
    }
});

router.get('/rejected', async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'rejected' }).populate('company', 'name').sort({ updatedAt: -1 });
        res.render('pages/jobs', { jobs, title: 'Rejected Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Rejected Jobs' });
    }
});

router.get('/job/:id', async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const job = await MatchedJob.findById(req.params.id).populate('company', 'name');
        res.render('pages/job-details', { job });
    } catch (error) {
        res.redirect('/jobs');
    }
});

router.get('/telegram', (req, res) => {
    res.render('pages/telegram-channels', { title: 'Telegram Channels' });
});

router.get('/companies', (req, res) => {
    res.render('pages/companies');
});

router.get('/analytics', (req, res) => {
    res.render('pages/analytics');
});

router.get('/profile', (req, res) => {
    res.render('pages/profile');
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

router.get('/evidence', async (req, res) => {
    try {
        const fs = require('fs').promises;
        const path = require('path');
        const evidencePath = path.join(__dirname, '..', 'evidence.json');
        let evidence = null;
        try {
            const data = await fs.readFile(evidencePath, 'utf8');
            evidence = JSON.parse(data);
        } catch (e) {
            console.error("Could not read evidence.json:", e.message);
        }
        res.render('pages/evidence', { title: 'Pipeline Debug Center', evidence });
    } catch (e) {
        res.render('pages/evidence', { title: 'Pipeline Debug Center', evidence: null });
    }
});

router.get('/ai-explainability', (req, res) => {
    res.render('pages/ai-explainability', { title: 'AI Explainability' });
});

module.exports = router;
