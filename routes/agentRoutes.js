/**
 * agentRoutes.js — Spider AI Agent API for RoleNova
 *
 * Exposes clean, LLM-friendly JSON endpoints that Spider AI (portfolio chatbot)
 * can call to read RoleNova state and trigger pipeline actions.
 *
 * Auth: All routes require the x-agent-token header matching AGENT_SECRET env var.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Mount point: /api/agent  (registered in index.js)
 */

const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();

// Models
const MatchedJob = require('../models/MatchedJob');
const RawJob = require('../models/RawJob');
const Company = require('../models/Company');
const SearchLog = require('../models/SearchLog');
const RejectedJob = require('../models/RejectedJob');

// Services
const pipelineState = require('../services/pipelineState');

// Auth Middleware
const requireAgentToken = (req, res, next) => {
    const token = req.headers['x-agent-token'];
    const secret = process.env.AGENT_SECRET;

    if (!token || !secret) {
        return res.status(401).json({ success: false, error: 'Missing agent token' });
    }
    if (token.length !== secret.length) {
        return res.status(403).json({ success: false, error: 'Invalid agent token' });
    }
    try {
        const match = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
        if (!match) return res.status(403).json({ success: false, error: 'Invalid agent token' });
    } catch {
        return res.status(403).json({ success: false, error: 'Invalid agent token' });
    }
    next();
};

router.use(requireAgentToken);

// Helper: IST start of day
const getISTStartOfDay = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const utcMidnight = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
    return new Date(utcMidnight.getTime() - (5.5 * 60 * 60 * 1000));
};

const msToHuman = (ms) => {
    if (!ms || ms < 0) return 'N/A';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
};

// GET /api/agent/ping
// Connectivity health check
router.get('/ping', (req, res) => {
    res.json({
        success: true,
        service: 'rolenova-agent-api',
        status: 'online',
        timestamp: new Date().toISOString(),
        db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        pipeline: pipelineState.running ? 'running' : 'idle'
    });
});

// GET /api/agent/status
// Live pipeline state + today's key stats
router.get('/status', async (req, res) => {
    try {
        const startOfDay = getISTStartOfDay();
        const [rawToday, matchedToday, totalMatched, pendingEval, allTimeRaw, allTimeRejectedModels, reviewRejected] = await Promise.all([
            RawJob.countDocuments({ scrapedAt: { $gte: startOfDay } }),
            MatchedJob.countDocuments({ createdAt: { $gte: startOfDay } }),
            MatchedJob.countDocuments(),
            RawJob.countDocuments({ aiEvaluated: { $ne: true } }),
            RawJob.countDocuments(),
            RejectedJob.countDocuments(),
            MatchedJob.countDocuments({ status: 'rejected' })
        ]);

        const snap = pipelineState.snapshot();

        res.json({
            success: true,
            pipeline: {
                status: snap.running ? 'Running' : (snap.currentStage || 'Idle'),
                stage: snap.currentStage,
                currentCompany: snap.currentCompany || null,
                currentATS: snap.currentATS || null,
                progress: snap.progress || '0%',
                elapsed: msToHuman(snap.elapsedTime),
                jobsFound: snap.jobsFound || 0,
                matchedJobs: snap.matchedJobs || 0,
                aiEvaluated: snap.aiEvaluated || 0,
                successCompanies: snap.successfulCompanies || 0,
                failedCompanies: snap.failedCompanies || 0,
                lastRunTime: snap.endTime ? new Date(snap.endTime).toISOString() : null,
                nextRunTime: snap.nextRunTime ? new Date(snap.nextRunTime).toISOString() : null
            },
            today: {
                jobsScraped: rawToday,
                jobsMatched: matchedToday,
                pendingEvaluation: pendingEval
            },
            totals: {
                allTimeScraped: allTimeRaw,
                allTimeMatched: totalMatched,
                allTimeRejected: allTimeRejectedModels > 0 ? allTimeRejectedModels : Math.max(0, allTimeRaw - totalMatched),
                reviewRejected: reviewRejected,
                db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
            }
        });
    } catch (err) {
        console.error('[Agent] /status error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/agent/jobs/today
// Top AI-matched jobs from today (limit 10, sorted by score desc)

// GET /api/agent/jobs/rejected
// Comprehensive rejection analytics: counts (today & all-time), breakdown by reason, and sample rejected jobs
router.get('/jobs/rejected', async (req, res) => {
    try {
        const startOfDay = getISTStartOfDay();
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

        const [
            rawToday,
            matchedToday,
            allTimeRaw,
            allTimeMatched,
            allTimeRejectedModels,
            reviewRejected,
            recentLog,
            sampleRejected
        ] = await Promise.all([
            RawJob.countDocuments({ scrapedAt: { $gte: startOfDay } }),
            MatchedJob.countDocuments({ createdAt: { $gte: startOfDay } }),
            RawJob.countDocuments(),
            MatchedJob.countDocuments(),
            RejectedJob.countDocuments(),
            MatchedJob.countDocuments({ status: 'rejected' }),
            SearchLog.findOne().sort({ createdAt: -1 }).select('validationDropsByReason createdAt'),
            RejectedJob.find().sort({ createdAt: -1 }).limit(limit).select('role company reason score status createdAt')
        ]);

        const todayRejected = Math.max(0, rawToday - matchedToday);
        const allTimeRejectedTotal = allTimeRejectedModels > 0 ? allTimeRejectedModels : Math.max(0, allTimeRaw - allTimeMatched);
        const rawDrops = recentLog?.validationDropsByReason || {};
        const sortedReasons = Object.entries(rawDrops).sort((a, b) => b[1] - a[1]).slice(0, 15);

        res.json({
            success: true,
            counts: {
                todayScraped: rawToday,
                todayMatched: matchedToday,
                todayRejected: todayRejected,
                allTimeScraped: allTimeRaw,
                allTimeMatched: allTimeMatched,
                allTimeRejected: allTimeRejectedTotal,
                reviewRejected: reviewRejected,
                todayRejectionRate: rawToday > 0 ? `${((todayRejected / rawToday) * 100).toFixed(1)}%` : "N/A",
                allTimeRejectionRate: allTimeRaw > 0 ? `${((allTimeRejectedTotal / allTimeRaw) * 100).toFixed(1)}%` : "N/A"
            },
            topRejectionReasons: Object.fromEntries(sortedReasons),
            recentRejectedSample: sampleRejected.map(j => ({
                role: j.role,
                company: j.company,
                reason: j.reason,
                score: j.score,
                date: j.createdAt?.toISOString().split('T')[0]
            }))
        });
    } catch (err) {
        console.error('[Agent] /jobs/rejected error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/jobs/today', async (req, res) => {
    try {
        const startOfDay = getISTStartOfDay();
        const limit = Math.min(parseInt(req.query.limit) || 10, 25);

        const jobs = await MatchedJob.find({ createdAt: { $gte: startOfDay } })
            .sort({ score: -1 })
            .limit(limit)
            .populate('company', 'name')
            .select('role company location score confidence suitable reason applyLink matchedSkills missingSkills status createdAt');

        const formatted = jobs.map(j => ({
            id: j._id,
            role: j.role,
            company: j.company?.name || 'Unknown',
            location: j.location,
            score: j.score,
            confidence: j.confidence,
            suitable: j.suitable,
            reason: j.reason,
            applyLink: j.applyLink,
            matchedSkills: (j.matchedSkills || []).slice(0, 5),
            missingSkills: (j.missingSkills || []).slice(0, 3),
            status: j.status,
            postedAt: j.createdAt
        }));

        res.json({ success: true, count: formatted.length, date: new Date().toISOString().split('T')[0], jobs: formatted });
    } catch (err) {
        console.error('[Agent] /jobs/today error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/agent/jobs/digest
// Best matches overall (score >= 70, suitable=true), formatted as digest
router.get('/jobs/digest', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 8, 20);
        const minScore = parseInt(req.query.minScore) || 70;

        const jobs = await MatchedJob.find({ score: { $gte: minScore }, suitable: true, status: { $ne: 'rejected' } })
            .sort({ score: -1 })
            .limit(limit)
            .populate('company', 'name')
            .select('role company location score confidence reason applyLink matchedSkills status createdAt');

        const formatted = jobs.map(j => ({
            role: j.role,
            company: j.company?.name || 'Unknown',
            location: j.location || 'Remote',
            score: j.score,
            confidence: j.confidence,
            reason: j.reason,
            applyLink: j.applyLink,
            topSkills: (j.matchedSkills || []).slice(0, 4),
            status: j.status,
            date: j.createdAt?.toISOString().split('T')[0]
        }));

        res.json({ success: true, count: formatted.length, minScore, digest: formatted });
    } catch (err) {
        console.error('[Agent] /jobs/digest error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/agent/companies/health
// Company scraper health breakdown — broken/critical/warning/healthy
router.get('/companies/health', async (req, res) => {
    try {
        const companies = await Company.find({ active: true }, 'name healthScore failureReason lastScrapedAt');

        const healthy = [], warning = [], critical = [], broken = [];
        companies.forEach(c => {
            const e = { name: c.name, score: c.healthScore, failure: c.failureReason, lastScrape: c.lastScrapedAt };
            if (c.healthScore >= 80) healthy.push(e);
            else if (c.healthScore >= 50) warning.push(e);
            else if (c.healthScore >= 20) critical.push(e);
            else broken.push(e);
        });

        broken.sort((a, b) => a.score - b.score);
        critical.sort((a, b) => a.score - b.score);

        res.json({
            success: true,
            summary: { total: companies.length, healthy: healthy.length, warning: warning.length, critical: critical.length, broken: broken.length },
            broken: broken.slice(0, 10),
            critical: critical.slice(0, 10),
            warning: warning.slice(0, 5)
        });
    } catch (err) {
        console.error('[Agent] /companies/health error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/agent/runs/history
// Last N SearchLog pipeline runs
router.get('/runs/history', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 5, 20);
        const logs = await SearchLog.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('createdAt companiesScanned jobsScraped jobsSaved duplicates parserOutdated atsChanged httpFailed jobsFound');

        const formatted = logs.map(l => ({
            date: l.createdAt?.toISOString(),
            companiesScanned: l.companiesScanned,
            jobsScraped: l.jobsScraped,
            jobsSaved: l.jobsSaved,
            duplicates: l.duplicates,
            parserErrors: l.parserOutdated,
            atsChanged: l.atsChanged,
            httpFailed: l.httpFailed,
            jobsFound: l.jobsFound
        }));

        res.json({ success: true, count: formatted.length, runs: formatted });
    } catch (err) {
        console.error('[Agent] /runs/history error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/agent/llm/status
// AI provider health from pipelineState / llmPingService
router.get('/llm/status', (req, res) => {
    try {
        const { getProvidersMetadata } = require('../services/llmPingService');
        const providers = getProvidersMetadata();
        res.json({ success: true, providers });
    } catch {
        res.json({
            success: true,
            providers: {
                gemini: pipelineState.geminiStatus || 'Unknown',
                groq: pipelineState.groqStatus || 'Unknown',
                openrouter: pipelineState.openrouterStatus || 'Unknown',
                local: 'Ready'
            }
        });
    }
});

// GET /api/agent/errors
// Recent scraper errors: parser failures, Cloudflare blocks, broken adapters
router.get('/errors', async (req, res) => {
    try {
        const recentLog = await SearchLog.findOne().sort({ createdAt: -1 })
            .select('parserOutdated atsChanged httpFailed createdAt validationDropsByReason');

        const snap = pipelineState.snapshot();

        const brokenCompanies = await Company.find({ active: true, healthScore: { $lt: 30 } }, 'name healthScore failureReason lastScrapedAt').limit(10);

        res.json({
            success: true,
            lastRun: recentLog ? {
                date: recentLog.createdAt,
                parserFailures: recentLog.parserOutdated || 0,
                atsChanges: recentLog.atsChanged || 0,
                httpFailed: recentLog.httpFailed || 0,
                validationDropsByReason: recentLog.validationDropsByReason || {}
            } : null,
            liveSession: {
                parserErrors: snap.parserErrors || 0,
                cloudflareBlocks: snap.cloudflareBlocks || 0,
                retryCount: snap.retryCount || 0,
                puppeteerFallbacks: snap.puppeteerFallbackCount || 0
            },
            brokenAdapters: brokenCompanies.map(c => ({
                name: c.name,
                score: c.healthScore,
                reason: c.failureReason,
                lastSeen: c.lastScrapedAt
            }))
        });
    } catch (err) {
        console.error('[Agent] /errors error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/agent/pipeline/run
// Trigger a new scrape run (fires async — returns immediately)
router.post('/pipeline/run', async (req, res) => {
    try {
        if (pipelineState.running) {
            return res.status(409).json({
                success: false,
                error: 'Pipeline is already running.',
                currentStage: pipelineState.currentStage,
                progress: pipelineState.progress
            });
        }
        const runSearch = require('../cron/jobSearchCron');
        runSearch('SpiderAI-Agent').catch(e => console.error('[Agent] Pipeline run error:', e.message));
        res.json({
            success: true,
            message: 'Pipeline scrape triggered. Running in background.',
            triggeredAt: new Date().toISOString(),
            triggeredBy: 'SpiderAI-Agent'
        });
    } catch (err) {
        console.error('[Agent] /pipeline/run error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/agent/pipeline/stop
// Cancel an active pipeline run
router.post('/pipeline/stop', async (req, res) => {
    try {
        if (!pipelineState.running) {
            return res.json({ success: false, message: 'No pipeline is currently running.' });
        }
        const PipelineLock = require('../models/PipelineLock');
        pipelineState.cancel();
        await PipelineLock.updateOne({ lockId: 'global_pipeline_lock' }, { $set: { status: 'Idle', runner: 'none' } });
        res.json({ success: true, message: 'Pipeline cancellation requested. Stops after current company finishes.' });
    } catch (err) {
        console.error('[Agent] /pipeline/stop error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/agent/cache/clear
// Force full re-scrape by clearing company cache timestamps
router.post('/cache/clear', async (req, res) => {
    try {
        const result = await Company.updateMany({}, { $set: { lastScrapedAt: null } });
        res.json({
            success: true,
            message: `Cache cleared for ${result.modifiedCount} companies. Next run will scrape everything fresh.`,
            companiesAffected: result.modifiedCount
        });
    } catch (err) {
        console.error('[Agent] /cache/clear error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
