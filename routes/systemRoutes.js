const express = require('express');
const mongoose = require('mongoose');
const { getListenerStatus } = require('../services/telegramService');
const pipelineState = require('../services/pipelineState');
const SearchLog = require('../models/SearchLog');
const { getAnalyticsData } = require('../services/analyticsService');
const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");
const { getLiveTelemetry } = require('../controllers/jobController');

const router = express.Router();

router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

router.get('/live', requireViewer, getLiveTelemetry);

router.get('/ready', (req, res) => {
    res.json({ status: 'ok' });
});

router.get('/detailed-health', requireAdmin, async (req, res) => {
    let mongoLatency = 0;
    const mongoStart = Date.now();
    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.db.admin().ping();
            mongoLatency = Date.now() - mongoStart;
        }
    } catch (e) {
        mongoLatency = -1;
    }

    const listener = getListenerStatus() || {};

    const health = {
        status: "Healthy",
        uptime: process.uptime(),
        version: process.env.npm_package_version || "1.0.0",
        environment: process.env.NODE_ENV || "development",
        mongodb: {
            connected: mongoose.connection.readyState === 1,
            latencyMs: mongoLatency
        },
        telegram: {
            connected: !!listener.connected,
            listenerRegistered: !!listener.connected,
            lastMessageAt: listener.lastJobMessageAt || null,
            lastHealthCheck: listener.lastHealthCheckAt || null,
            monitoredChannels: listener.monitoredChannels || []
        },
        ai: {
            gemini: pipelineState.geminiStatus || "Unknown",
            groq: pipelineState.groqStatus || "Unknown",
            zai: pipelineState.zaiStatus || "Unknown",
            local: pipelineState.localStatus || "Ready"
        },
        cron: {
            running: pipelineState.status === "Running",
            lastRun: pipelineState.lastRunTime || null,
            currentStage: pipelineState.currentStage || "Idle",
            currentCompany: pipelineState.currentCompany || "None",
            currentAts: pipelineState.currentAts || "None",
            queueDepth: pipelineState.queueSize || 0,
            progress: pipelineState.progress || "0 / 0",
            totalCompanies: pipelineState.totalCompanies || 0,
            elapsedTime: pipelineState.elapsedTime || 0,
            estimatedRemainingTime: pipelineState.estimatedRemainingTime || 0,
            nextRunTime: pipelineState.nextRunTime || null
        },
        memory: {
            rss: process.memoryUsage().rss,
            heapTotal: process.memoryUsage().heapTotal,
            heapUsed: process.memoryUsage().heapUsed,
            external: process.memoryUsage().external
        }
    };

    res.json(health);
});

router.get('/metrics', requireAdmin, async (req, res) => {
    try {
        const analytics = await getAnalyticsData();
        const metrics = {
            "Messages Received": analytics.stats.rawJobsToday || 0,
            "Jobs Parsed": analytics.stats.rawJobsCount || 0,
            "Raw Jobs": analytics.stats.rawJobsCount || 0,
            "AI Evaluations": analytics.stats.aiEvaluatedCount || 0,
            "Matched Jobs": analytics.stats.matchedJobsCount || 0,
            "Emails Sent": analytics.stats.newJobsCount || 0,
            "Duplicates": analytics.systemMetrics?.totalDuplicates || 0,
            "Parser Failures": analytics.systemMetrics?.totalParserOutdated || 0,
            "ATS Changed": analytics.systemMetrics?.totalAtsChanged || 0,
            "Validation Failures": analytics.systemMetrics?.totalValidationDrops || 0,
            "Actually Scraped": analytics.systemMetrics?.totalJobsScraped || 0,
            "Recovered Nodes": analytics.systemMetrics?.totalRetriedSuccessfully || 0,
            "Cloudflare Blocks": analytics.systemMetrics?.totalBlocked || 0,
            "Provider Usage": analytics.aiMetrics?.providerStats || [],
            "Average AI Time": analytics.systemMetrics?.avgEvaluationTime || 0,
            "Average Runtime": analytics.systemMetrics?.avgRuntime || 0,
            "Listener Uptime": process.uptime()
        };
        res.json(metrics);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/timeline', requireAdmin, async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(50);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// New Endpoints
router.post('/pipeline/stop', requireAdmin, async (req, res) => {
    try {
        const PipelineLock = require('../models/PipelineLock');
        pipelineState.cancel = true;
        await PipelineLock.updateOne({ lockId: "global_pipeline_lock" }, { $set: { status: "Idle", runner: "none" } });
        res.json({ success: true, message: "Pipeline cancellation requested." });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/cache-metrics', requireAdmin, async (req, res) => {
    try {
        const Company = require('../models/Company');
        const TWELVE_HOURS = 12 * 60 * 60 * 1000;
        const now = Date.now();
        const companies = await Company.find({ active: true }, 'lastScrapedAt');
        
        let cached = 0;
        let expired = 0;
        
        companies.forEach(c => {
            if (c.lastScrapedAt && (now - new Date(c.lastScrapedAt).getTime()) < TWELVE_HOURS) {
                cached++;
            } else {
                expired++;
            }
        });
        
        res.json({
            success: true,
            metrics: {
                ttl: "12 Hours",
                totalCompanies: companies.length,
                cachedCompanies: cached,
                expiredCompanies: expired,
                hitRate: companies.length > 0 ? Math.round((cached / companies.length) * 100) : 0,
                cacheSavings: cached * 4500 // approx 4.5s per company
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/cache/clear', requireAdmin, async (req, res) => {
    try {
        const Company = require('../models/Company');
        await Company.updateMany({}, { $set: { lastScrapedAt: null } });
        res.json({ success: true, message: "Global cache cleared successfully." });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
