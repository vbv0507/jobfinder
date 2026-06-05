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
        enum: ["Success", "Partial Success", "Failed"]
    },

    errorDetails: [
        {
            company: String,
            jobTitle: String,
            message: String
        }
    ]

}, { timestamps: true });

module.exports = mongoose.model("SearchLog", searchLogSchema);
