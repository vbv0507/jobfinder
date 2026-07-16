const mongoose = require("mongoose");

const pipelineLockSchema = new mongoose.Schema({
    lockId: { type: String, required: true, unique: true, default: "global_pipeline_lock" },
    status: { type: String, enum: ["Idle", "Running"], default: "Idle" },
    startedAt: { type: Date, default: null },
    runner: { type: String, default: "none" },
    expiresAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model("PipelineLock", pipelineLockSchema);
