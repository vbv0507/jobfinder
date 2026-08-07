const mongoose = require("mongoose");

const telegramListenerLockSchema = new mongoose.Schema({
    lockId: { type: String, required: true, unique: true, default: "global_telegram_listener" },
    status: { type: String, enum: ["Idle", "Running"], default: "Idle" },
    ownerId: { type: String, default: null },
    hostname: { type: String, default: null },
    pid: { type: Number, default: null },
    startedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }
}, { timestamps: true });

telegramListenerLockSchema.index({ expiresAt: 1 });

module.exports = mongoose.model("TelegramListenerLock", telegramListenerLockSchema);
