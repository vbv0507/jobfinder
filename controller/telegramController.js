const TelegramChannel = require('../models/TelegramChannel');


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
            { new: true }
        );
        
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Channel not found' });
        }
        
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
        
        res.status(201).json({ success: true, channel });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.deleteChannel = async (req, res) => {
    try {
        const { id } = req.params;
        await TelegramChannel.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Channel deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
