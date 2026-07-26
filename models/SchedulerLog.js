const mongoose = require("mongoose");

const schedulerLogSchema = new mongoose.Schema({
    runDate: {
        type: Date,
        default: Date.now
    },
    startedAt: Date,
    completedAt: Date,
    durationMs: Number,
    
    triggerSource: {
        type: String,
        default: "Unknown"
    },
    
    result: {
        type: String,
        enum: ["Success", "Partial Success", "Failed", "Cancelled", "Skipped", "Running"],
        default: "Running"
    },
    
    metrics: {
        companies: { type: Number, default: 0 },
        jobs: { type: Number, default: 0 },
        matched: { type: Number, default: 0 },
        rejected: { type: Number, default: 0 }
    },
    
    error: String

}, { timestamps: true });

module.exports = mongoose.model("SchedulerLog", schedulerLogSchema);
