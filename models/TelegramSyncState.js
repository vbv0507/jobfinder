const mongoose = require("mongoose");

const telegramSyncStateSchema = new mongoose.Schema(
    {
        channelId: {
            type: String,
            required: true,
            unique: true,
        },
        channelUsername: {
            type: String,
            required: true,
        },
        lastProcessedMessageId: {
            type: Number,
            default: 0,
        },
        lastProcessedDate: {
            type: Date,
        },
        lastSyncTime: {
            type: Date,
        },
        // Cumulative lifetime stats
        totalMessagesScanned: { type: Number, default: 0 },
        totalJobsExtracted:   { type: Number, default: 0 },
        totalJobsMatched:     { type: Number, default: 0 },
        totalJobsRejected:    { type: Number, default: 0 },
        totalDuplicates:      { type: Number, default: 0 },
        totalErrors:          { type: Number, default: 0 },
    },
    { timestamps: true }
);

telegramSyncStateSchema.index({ channelUsername: 1 });

module.exports = mongoose.model("TelegramSyncState", telegramSyncStateSchema);
