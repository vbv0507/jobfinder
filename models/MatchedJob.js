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

    missingSkills: [String],

    domainMismatch: Boolean,
    
    jobDomain: String,
    
    evaluatedBy: {
        type: String,
        enum: ["Gemini", "Groq", "Local", "AI"], 
        default: "Gemini"
    },
    
    evaluationMetrics: {
        provider: String,
        durationMs: Number,
        fallbackCount: Number,
        failureReason: String
    },

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

matchedJobSchema.index({ rawJob: 1 }, { unique: true });
matchedJobSchema.index({ score: -1 });
matchedJobSchema.index({ applied: 1, appliedAt: -1 });

module.exports = mongoose.model(
    "MatchedJob",
    matchedJobSchema
);
