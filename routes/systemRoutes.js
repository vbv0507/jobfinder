const express = require('express');
const mongoose = require('mongoose');
const { getListenerStatus } = require('../services/telegramService');
const pipelineState = require('../services/pipelineState');
const SearchLog = require('../models/SearchLog');
const { getAnalyticsData } = require('../services/analyticsService');

const router = express.Router();

router.get('/health', async (req, res) => {
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
        pipeline: {
            running: pipelineState.status === "Running",
            lastRun: pipelineState.lastRunTime || null,
            currentStage: pipelineState.currentStage || "Idle",
            queueDepth: pipelineState.estimatedRemainingTime > 0 ? 1 : 0
        }
    };

    res.json(health);
});

router.get('/metrics', async (req, res) => {
    try {
        const analytics = await getAnalyticsData();
        const metrics = {
            "Messages Received": analytics.stats.rawJobsToday || 0,
            "Jobs Parsed": analytics.stats.rawJobsCount || 0,
            "Raw Jobs": analytics.stats.rawJobsCount || 0,
            "AI Evaluations": analytics.stats.aiEvaluatedCount || 0,
            "Matched Jobs": analytics.stats.matchedJobsCount || 0,
            "Emails Sent": analytics.stats.newJobsCount || 0,
            "Duplicates": analytics.stats.totalDuplicatePrevention || 0,
            "Parser Failures": analytics.stats.failureRate || 0,
            "Validation Failures": analytics.stats.skippedRuns || 0,
            "Provider Usage": analytics.aiMetrics.providerStats || [],
            "Average AI Time": analytics.stats.avgEvaluationTimeMs || 0,
            "Average Company Time": analytics.stats.avgRuntimeMs || 0,
            "Listener Uptime": process.uptime()
        };
        res.json(metrics);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/timeline', async (req, res) => {
    try {
        const logs = await SearchLog.find().sort({ createdAt: -1 }).limit(50);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
