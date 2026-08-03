require('dotenv').config();
const mongoose = require('mongoose');
const TelegramSyncState = require('../models/TelegramSyncState');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    await TelegramSyncState.deleteMany({});
    console.log("Deleted all sync states to force re-sync.");
    await mongoose.connection.close();
}
main();
