const mongoose = require("mongoose");

const searchLogSchema = new mongoose.Schema({

    runDate: {
        type: Date,
        default: Date.now
    },

    startedAt: Date,

    completedAt: Date,

    durationMs: Number,

    companiesScanned: Number,

    jobsFound: Number,

    jobsMatched: Number,

    status: {
        type: String,
        enum: ["Success", "Partial Success", "Failed", "Skipped", "Running"]
    },

    pipelineId: String,
    triggerSource: String,
    skipReason: String,
    aiProviderUsed: String,

    currentRunner: String,
    expectedUnlock: Date,

    totalCompanies: Number,
    successfulCompanies: Number,
    failedCompanies: Number,
    totalJobs: Number,
    newJobs: Number,
    aiEvaluations: Number,

    // Phase 10: Execution Timelines
    companyTimelines: {
        type: Map,
        of: [{
            timestamp: Date,
            stage: String,
            severity: { type: String, enum: ["INFO", "WARN", "ERROR", "SUCCESS"] },
            message: String,
            httpCode: Number,
            durationMs: Number,
            retryCount: Number
        }],
        default: {}
    },

    // Phase 11: Pipeline Summary Metrics
    companiesWithJobs: { type: Number, default: 0 },
    companiesWithoutJobs: { type: Number, default: 0 },
    parserOutdated: { type: Number, default: 0 },
    atsChanged: { type: Number, default: 0 },
    httpFailed: { type: Number, default: 0 },
    blocked: { type: Number, default: 0 },
    retriedSuccessfully: { type: Number, default: 0 },
    jobsScraped: { type: Number, default: 0 },
    jobsSaved: { type: Number, default: 0 },
    jobsEvaluated: { type: Number, default: 0 },
    validationDrops: { type: Number, default: 0 },
    validationDropsByReason: { type: mongoose.Schema.Types.Mixed, default: {} },
    matchedJobs: { type: Number, default: 0 },
    duplicates: { type: Number, default: 0 },

    geminiCount: { type: Number, default: 0 },
    geminiSuccess: { type: Number, default: 0 },
    geminiFailed: { type: Number, default: 0 },
    geminiFallbacks: { type: Number, default: 0 },
    groqCount: { type: Number, default: 0 },
    groqSuccess: { type: Number, default: 0 },
    groqFailed: { type: Number, default: 0 },
    groqFallbacks: { type: Number, default: 0 },
    zaiCount: { type: Number, default: 0 },
    zaiSuccess: { type: Number, default: 0 },
    zaiFailed: { type: Number, default: 0 },
    zaiFallbacks: { type: Number, default: 0 },
    localCount: { type: Number, default: 0 },
    localSuccess: { type: Number, default: 0 },
    averageCompanyTime: Number,
    averageAiTime: Number,

    errorType: String,
    companyBeingProcessed: String,
    currentStage: String,
    stackTrace: String,

    message: String,

    jobsArchived: { type: Number, default: 0 },
    jobsRefreshed: { type: Number, default: 0 },
    duplicatePreventionCount: { type: Number, default: 0 },
    averageEvaluationTimeMs: { type: Number, default: 0 },
    averageMetadataRefreshTimeMs: { type: Number, default: 0 },

    errorDetails: [
        {
            company: String,
            jobTitle: String,
            message: String
        }
    ]

}, { timestamps: true });

module.exports = mongoose.model("SearchLog", searchLogSchema);
