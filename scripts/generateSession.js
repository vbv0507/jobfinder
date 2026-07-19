const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
require("dotenv").config();

(async () => {
    console.log("=========================================================");
    console.log("             RoleNova Telegram Session Generator         ");
    console.log("=========================================================");
    
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    
    if (!apiId || !apiHash) {
        console.error("❌ ERROR: TELEGRAM_API_ID or TELEGRAM_API_HASH is missing from your .env file.");
        console.error("Please add them and try again.");
        process.exit(1);
    }
    
    console.log("✓ API ID and Hash found.");
    console.log("Connecting to Telegram...\n");
    
    const stringSession = new StringSession(""); // Empty string means creating a new session
    const client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
        connectionRetries: 5,
    });
    
    try {
        await client.start({
            phoneNumber: async () => await input.text("Please enter your number (e.g. +919876543210): "),
            password: async () => await input.text("Please enter your 2FA password (if any, otherwise press enter): "),
            phoneCode: async () => await input.text("Please enter the code you received via Telegram: "),
            onError: (err) => console.error("Error during authentication:", err.message),
        });
        
        console.log("\n=========================================================");
        console.log("✅ SESSION SUCCESSFULLY GENERATED!");
        console.log("=========================================================\n");
        console.log("Copy the following string and paste it into your Azure App Service environment variables:");
        console.log("\nTELEGRAM_SESSION=" + client.session.save() + "\n");
        console.log("=========================================================");
        
        await client.disconnect();
        process.exit(0);
    } catch (error) {
        console.error("\n❌ Failed to generate session:");
        console.error(error.message);
        process.exit(1);
    }
})();
