const mongoose = require('mongoose');
const TelegramChannel = require('./models/TelegramChannel');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    const channels = [
        {
            name: 'LMT Job Updates',
            username: 'LMTPlacements',
            category: 'Internships',
            enabled: true,
            priority: 1
        },
        {
            name: 'TechUprise - Exclusive Updates',
            username: 'TechUprise_Updates',
            category: 'Product Companies',
            enabled: true,
            priority: 1
        }
    ];

    for (const ch of channels) {
        await TelegramChannel.findOneAndUpdate(
            { username: ch.username },
            { $set: ch },
            { upsert: true, new: true }
        );
    }
    console.log("Channels seeded.");
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
