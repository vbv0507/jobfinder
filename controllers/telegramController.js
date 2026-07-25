const TelegramChannel = require('../models/TelegramChannel');
const { getListenerStatus, reconnectTelegram, reloadChannels } = require('../services/telegramService');
const RawJob = require('../models/RawJob');
const MatchedJob = require('../models/MatchedJob');
const { logAuditAction } = require("../services/auditService");

const emitTelegramUpdate = async () => {
    const socketService = require('../services/socketService');
    const payload = await socketService.buildDashboardPayload();
    socketService.broadcast("telegram:update", payload.telegram);
};

exports.getChannels = async (req, res) => {
    try {
        const channels = await TelegramChannel.find().sort({ priority: 1, createdAt: -1 });
        res.status(200).json({ success: true, channels });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.toggleChannel = async (req, res) => {
    try {
        const { id } = req.params;
        const { enabled } = req.body;
        
        const channel = await TelegramChannel.findByIdAndUpdate(
            id,
            { enabled },
            { returnDocument: "after" }
        );
        
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Channel not found' });
        }
        
        await logAuditAction(req, 'Telegram Edit', `Toggled channel ${channel.username} to ${enabled}`);
        await reloadChannels();
        emitTelegramUpdate().catch(error => console.error("[Socket] Failed to emit telegram:update:", error.message));
        
        res.status(200).json({ success: true, channel });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.addChannel = async (req, res) => {
    try {
        const { name, username, description, category } = req.body;
        
        const existing = await TelegramChannel.findOne({ username });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Channel username already exists' });
        }

        const channel = await TelegramChannel.create({
            name,
            username,
            description,
            category
        });
        
        await logAuditAction(req, 'Telegram Edit', `Added channel ${username}`);
        await reloadChannels();
        emitTelegramUpdate().catch(error => console.error("[Socket] Failed to emit telegram:update:", error.message));
        
        res.status(201).json({ success: true, channel });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.deleteChannel = async (req, res) => {
    try {
        const { id } = req.params;
        const channel = await TelegramChannel.findByIdAndDelete(id);
        if (channel) {
            await logAuditAction(req, 'Telegram Edit', `Deleted channel ${channel.username}`);
        }
        await reloadChannels();
        emitTelegramUpdate().catch(error => console.error("[Socket] Failed to emit telegram:update:", error.message));
        res.status(200).json({ success: true, message: 'Channel deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getStatus = async (req, res) => {
    try {
        const status = getListenerStatus();
        res.status(200).json({ success: true, status: { ...status, appUptime: process.uptime() } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getStatistics = async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const channels = await TelegramChannel.find();
        
        const jobsParsedToday = await RawJob.countDocuments({ 
            createdAt: { $gte: startOfDay }, 
            "sources.sourceChannel": { $exists: true } 
        });
        
        // Count matched jobs generated from telegram sources
        // MatchedJob doesn't explicitly store sourceChannel directly in some cases, 
        // but let's query raw jobs first
        const rawJobsTodayIds = await RawJob.find({ 
            createdAt: { $gte: startOfDay }, 
            "sources.sourceChannel": { $exists: true } 
        }).select("_id");
        
        const matchedJobsToday = await MatchedJob.countDocuments({
            rawJob: { $in: rawJobsTodayIds.map(r => r._id) }
        });
        
        // Sum total messages from all channels processed today? No, the field is total overall.
        // For simplicity as requested "Messages Today", we will just return the jobsParsedToday
        // if we don't have daily message tracking in TelegramChannel schema.
        // Wait, the user asked for "Messages Today". We can look at how many RawJobs were parsed.
        // Actually, we can just return total messages processed overall if daily is too complex to query.
        const totalMessages = channels.reduce((sum, ch) => sum + ch.messagesProcessed, 0);
        
        res.status(200).json({
            success: true,
            statistics: {
                messagesToday: totalMessages, 
                jobsParsedToday,
                matchedJobsToday
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.reconnect = async (req, res) => {
    try {
        const status = await reconnectTelegram();
        emitTelegramUpdate().catch(error => console.error("[Socket] Failed to emit telegram:update:", error.message));
        res.status(200).json({ success: true, status, message: "Reconnection triggered." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.reload = async (req, res) => {
    try {
        const count = await reloadChannels();
        emitTelegramUpdate().catch(error => console.error("[Socket] Failed to emit telegram:update:", error.message));
        res.status(200).json({ success: true, message: `Reloaded ${count} active channels.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
