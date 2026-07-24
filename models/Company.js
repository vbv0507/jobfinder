const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
    scraperConfig: {
      ats: String,
      apiUrl: String,
      apiMethod: { type: String, default: "GET", enum: ["GET", "POST"] },
      apiHeaders: { type: Map, of: String },
      apiPayload: { type: mongoose.Schema.Types.Mixed },
      lastVerified: Date,
      version: String
    },
    // Core Configuration
    name: {
        type: String,
        required: true,
        unique: true,
    },
    careerUrl: {
        type: String,
        required: true,
    },
    ats: {
        type: String,
        required: true,
        index: true,
    },
    adapter: {
        type: String,
    },
    active: {
        type: Boolean,
        default: true,
    },
    priority: {
        type: Number,
        default: 2,
    },
    supported: {
        type: Boolean,
        default: true,
    },
    targetLocations: [{
        type: String,
    }],
    targetKeywords: [{
        type: String,
    }],
    excludedKeywords: [{
        type: String,
    }],
    
    // Metadata
    category: {
        type: String,
        required: true,
    },
    logo: { type: String },
    industry: { type: String },
    companyDescription: { type: String },

    lastScan: {
        type: Date,
    },

    jobsFound: {
        type: Number,
        default: 0,
    },

    matchedJobs: {
        type: Number,
        default: 0,
    },

    lastRunStatus: {
        type: String,
        enum: ["success", "partial", "failed"],
    },

    lastError: {
        type: String,
    },

    // Phase 8: Health Monitoring
    lastSuccess: { type: Date },
    lastFailure: { type: Date },
    failureReason: { type: String },
    totalRuns: { type: Number, default: 0 },
    successRuns: { type: Number, default: 0 },
    successPercent: { type: Number, default: 0 },
    totalTimeSpent: { type: Number, default: 0 },
    avgResponseTime: { type: Number, default: 0 },

    // Phase 10: Intelligent Cache
    lastScrapedAt: { type: Date },

    // Phase 8 & 9: Additional Health Metrics
    lastHttpStatus: { type: String },
    lastAts: { type: String },
    lastParser: { type: String },
    retryCount: { type: Number, default: 0 },
    jobsSaved: { type: Number, default: 0 },
    jobsEvaluated: { type: Number, default: 0 },
    healthScore: { type: Number, default: 100 },
    
    // Phase 13: Historical Analytics
    runHistory: [{ type: mongoose.Schema.Types.Mixed }],
    
    // Phase 14: Execution Timeline
    latestExecutionTimeline: [{
        timestamp: Date,
        stage: String,
        severity: { type: String, enum: ["INFO", "WARN", "ERROR", "SUCCESS"] },
        message: String,
        httpCode: Number,
        durationMs: Number,
        retryCount: Number
    }],
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
