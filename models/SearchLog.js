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
    geminiCount: { type: Number, default: 0 },
    groqCount: { type: Number, default: 0 },
    zaiCount: { type: Number, default: 0 },
    localCount: { type: Number, default: 0 },
    averageCompanyTime: Number,

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
