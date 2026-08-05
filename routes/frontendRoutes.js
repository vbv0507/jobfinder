const express = require('express');
const { requireAuth, requireAdmin, requireExtendedViewer } = require('../middleware/authMiddleware');
const router = express.Router();

router.use(requireAuth);

router.get('/pipeline', requireAdmin, (req, res) => {
    res.render('pages/pipeline', { title: 'Pipeline Execution' });
});

router.get('/discovery', requireExtendedViewer, (req, res) => {
    res.render('pages/ats-discovery', { title: 'ATS Discovery Engine' });
});

router.get('/ai-rejected', requireExtendedViewer, async (req, res) => {
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

router.get('/jobs', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ 
            status: 'new', 
            provider: { $not: /^local/i },
            score: { $gte: 70 },
            jobStatus: { $ne: 'Closed' }
        }).populate('company', 'name').sort({ score: -1 });
        res.render('pages/jobs', { jobs, title: 'Matched Jobs (AI Evaluated)' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Matched Jobs (AI Evaluated)' });
    }
});

router.get('/closed-jobs', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ jobStatus: 'Closed' }).populate('company', 'name').sort({ closedAt: -1, updatedAt: -1 });
        res.render('pages/jobs', { jobs, title: 'Closed / Filled Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Closed / Filled Jobs' });
    }
});

router.get('/local-jobs', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'new', provider: /^local/i }).populate('company', 'name').sort({ score: -1 });
        res.render('pages/local-jobs', { jobs, title: 'Local Pending Jobs' });
    } catch (error) {
        res.render('pages/local-jobs', { jobs: [], title: 'Local Pending Jobs' });
    }
});

router.get('/saved', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'saved' }).populate('company', 'name').sort({ score: -1 });
        res.render('pages/jobs', { jobs, title: 'Saved Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Saved Jobs' });
    }
});

router.get('/applied', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'applied' }).populate('company', 'name').sort({ appliedAt: -1 });
        res.render('pages/jobs', { jobs, title: 'Applied Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Applied Jobs' });
    }
});

router.get('/rejected', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const jobs = await MatchedJob.find({ status: 'rejected' }).populate('company', 'name').sort({ updatedAt: -1 });
        res.render('pages/jobs', { jobs, title: 'Rejected Jobs' });
    } catch (error) {
        res.render('pages/jobs', { jobs: [], title: 'Rejected Jobs' });
    }
});

router.get('/job/:id', requireExtendedViewer, async (req, res) => {
    try {
        const MatchedJob = require('../models/MatchedJob');
        const job = await MatchedJob.findById(req.params.id).populate('company', 'name');
        res.render('pages/job-details', { job });
    } catch (error) {
        res.redirect('/jobs');
    }
});

router.get('/telegram', requireExtendedViewer, (req, res) => {
    res.render('pages/telegram-channels', { title: 'Telegram Channels' });
});

router.get('/companies', (req, res) => {
    res.render('pages/companies');
});

router.get('/analytics', (req, res) => {
    res.render('pages/analytics');
});

router.get('/profile', requireAdmin, (req, res) => {
    res.render('pages/profile');
});

router.get('/cache', requireAdmin, (req, res) => {
    res.render('pages/cache-dashboard', { title: 'Smart Cache' });
});

router.get('/ai-dashboard', requireExtendedViewer, (req, res) => {
    res.render('pages/ai-dashboard', { title: 'AI Evaluation' });
});

router.get('/logs', requireAdmin, (req, res) => {
    res.render('pages/logs', { title: 'Runtime Logs' });
});

router.get('/telegram-dashboard', requireExtendedViewer, (req, res) => {
    res.render('pages/telegram-dashboard', { title: 'Telegram Monitoring' });
});

router.get('/evidence', requireExtendedViewer, async (req, res) => {
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

router.get('/evidence/download/json', requireAdmin, (req, res) => {
    const path = require('path');
    const evidencePath = path.join(__dirname, '..', 'evidence.json');
    res.download(evidencePath, 'evidence.json', (err) => {
        if (err) {
            res.status(404).send("Evidence file not found.");
        }
    });
});

router.get('/evidence/download/zip', requireAdmin, (req, res) => {
    const path = require('path');
    const fs = require('fs');
    const archiver = require('archiver');
    const evidencePath = path.join(__dirname, '..', 'evidence.json');
    
    if (!fs.existsSync(evidencePath)) {
        return res.status(404).send("Evidence file not found.");
    }
    
    res.attachment('evidence.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err) => {
        res.status(500).send({error: err.message});
    });
    
    archive.pipe(res);
    archive.file(evidencePath, { name: 'evidence.json' });
    archive.finalize();
});

router.get('/ai-explainability', requireExtendedViewer, (req, res) => {
    res.render('pages/ai-explainability', { title: 'AI Explainability' });
});

module.exports = router;
