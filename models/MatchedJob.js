const mongoose = require("mongoose");

const matchedJobSchema = new mongoose.Schema({
    rawJob: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RawJob"
    },

    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company"
    },

    role: String,

    location: String,

    score: Number,
    
    scoringBreakdown: {
        roleMatch: Number,
        skillsMatch: Number,
        experienceMatch: Number,
        domainMatch: Number,
        locationMatch: Number
    },

    confidence: String,

    suitable: Boolean,

    reason: String,

    primaryReasons: [String],

    matchedSkills: [String],

    missingSkills: [String],
    
    strengths: [String],
    
    weaknesses: [String],
    
    mandatoryRequirements: [String],
    
    optionalRequirements: [String],

    domainMismatch: Boolean,
    
    jobDomain: String,

    emailed: {
        type: Boolean,
        default: false
    },
    
    evaluatedBy: {
        type: String,
        default: "Gemini"
    },
    
    provider: String,
    model: String,
    evaluationTimeMs: Number,
    fallbackCount: Number,
    fallbackReason: String,
    providerChain: [String],
    isDuplicate: { type: Boolean, default: false },
    
    evaluationMetrics: {
        provider: String,
        durationMs: Number,
        fallbackCount: Number,
        failureReason: String
    },

    evaluationHistory: [{
        provider: String,
        model: String,
        score: Number,
        evaluatedAt: { type: Date, default: Date.now },
        durationMs: Number,
        fallbackCount: Number,
        fallbackReason: String
    }],

    lastScrapedAt: Date,
    lastMetadataUpdate: Date,
    lastAIEvaluation: Date,

    isActive: { type: Boolean, default: true },
    jobStatus: String,
    closedAt: Date,

    domainExplanation: String,

    experienceMismatch: Boolean,

    roleMatch: String,

    experienceMatch: String,

    recommendation: String,

    applyLink: String,

    postedAt: Date,

    
    status: {
        type: String,
        enum: ["new", "saved", "applied", "rejected"],
        default: "new"
    },
    
    notes: String,
    
    timeline: [{
        status: String,
        date: { type: Date, default: Date.now }
    }],

    appliedAt: Date,

}, { timestamps: true });

matchedJobSchema.index({ rawJob: 1 }, { unique: true, sparse: true });
matchedJobSchema.index({ score: -1 });
matchedJobSchema.index({ status: 1, appliedAt: -1 });

module.exports = mongoose.model(
    "MatchedJob",
    matchedJobSchema
);
