require('dotenv').config();
const { startTelegramListener } = require('./services/telegramService');
const mongoose = require('mongoose');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");
    
    startTelegramListener();
    
    // give it 15 seconds to connect and run checks
    setTimeout(() => {
        console.log("Finished test.");
        process.exit(0);
    }, 15000);
}

test().catch(console.error);
