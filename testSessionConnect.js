require('dotenv').config({ path: 'd:/new/NODE/jobfinder/.env' });
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

(async () => {
    try {
        const s = new StringSession(process.env.TELEGRAM_SESSION);
        const client = new TelegramClient(s, parseInt(process.env.TELEGRAM_API_ID), process.env.TELEGRAM_API_HASH, {
            connectionRetries: 1,
        });
        console.log("Connecting...");
        await client.connect();
        console.log("Connected!");
        const isAuth = await client.isUserAuthorized();
        console.log("Is authorized:", isAuth);
        process.exit(0);
    } catch (e) {
        console.error("Failed:", e);
        process.exit(1);
    }
})();
