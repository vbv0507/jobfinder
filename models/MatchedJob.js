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

    applyLink: String

}, { timestamps: true });

matchedJobSchema.index({ rawJob: 1 }, { unique: true });
matchedJobSchema.index({ score: -1 });

module.exports = mongoose.model(
    "MatchedJob",
    matchedJobSchema
);
