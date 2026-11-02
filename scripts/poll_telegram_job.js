const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { ConnectionTCPObfuscated } = require("telegram/network/connection/TCPObfuscated");
const { runScript, requireEnvironment } = require("./jobRuntime");
const { runBackfill } = require("../services/telegramBackfillService");

runScript("GitHub Telegram Poll", async () => {
  requireEnvironment(["TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION"]);

  const session = new StringSession(process.env.TELEGRAM_SESSION);
  const client = new TelegramClient(session, Number(process.env.TELEGRAM_API_ID), process.env.TELEGRAM_API_HASH, {
    connectionRetries: 5,
    connection: ConnectionTCPObfuscated,
  });

  try {
    await client.connect();
    if (!await client.isUserAuthorized()) throw new Error("Telegram session is not authorized");

    // The 8 PM digest job sends email. Polling only stores newly found messages.
    await runBackfill(client, { processEmail: false });
  } finally {
    await client.disconnect().catch(() => {});
    if (typeof client.destroy === "function") await client.destroy().catch(() => {});
  }
});
