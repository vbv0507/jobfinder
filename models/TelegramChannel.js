const mongoose = require('mongoose');

const telegramChannelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true,
        unique: true
    },
    enabled: {
        type: Boolean,
        default: true
    },
    priority: {
        type: Number,
        default: 1
    },
    description: String,
    category: String,
    sourceType: {
        type: String,
        default: "Telegram"
    },
    messagesProcessed: {
        type: Number,
        default: 0
    },
    jobsFound: {
        type: Number,
        default: 0
    },
    matchedJobs: {
        type: Number,
        default: 0
    },
    errorCount: {
        type: Number,
        default: 0
    },
    lastActivity: Date,
}, { timestamps: true });

module.exports = mongoose.model("TelegramChannel", telegramChannelSchema);
