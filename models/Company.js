const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },

    careerUrl: {
        type: String,
        required: true,
    },

    category: {
        type: String,
        enum: ["Product", "Service"],
        required: true,
    },

    active: {
        type: Boolean,
        default: true,
    },

    scraperType: {
        type: String,
        enum: ["api"],
        default: "api",
    },

    scraperConfig: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },

    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },

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
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
