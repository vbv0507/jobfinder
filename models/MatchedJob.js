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

    suitable: Boolean,

    reason: String,

    missingSkills: [String],

    roleMatch: String,

    experienceMatch: String,

    recommendation: String,

    applyLink: String,

    postedAt: Date,

    // User ne apply kar diya to dashboard me Applied section me chala jayega.
    applied: {
        type: Boolean,
        default: false,
    },

    appliedAt: Date

}, { timestamps: true });

matchedJobSchema.index({ rawJob: 1 }, { unique: true });
matchedJobSchema.index({ score: -1 });
matchedJobSchema.index({ applied: 1, appliedAt: -1 });

module.exports = mongoose.model(
    "MatchedJob",
    matchedJobSchema
);
