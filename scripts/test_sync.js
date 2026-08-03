require('dotenv').config();
const mongoose = require('mongoose');
const { historicalSync } = require('../services/telegramService');

async function testSync() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Starting historical sync...");
    
    // We pass true for manual sync, though it will just process LMTPlacements
    try {
        await historicalSync('LMTPlacements', true);
    } catch (err) {
        console.error("Sync error:", err);
    }
    
    await mongoose.connection.close();
}

testSync();
