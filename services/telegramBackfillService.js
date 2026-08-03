/**
 * telegramBackfillService.js
 * Phase 17: Historical Backfill & Incremental Sync
 *
 * Runs ONCE per startup, non-blocking.
 * Uses TelegramSyncState to resume from last processed message.
 * Feeds every historical message through the same processMessageContent pipeline.
 */

const { Api } = require("telegram");
const TelegramChannel = require("../models/TelegramChannel");
const TelegramSyncState = require("../models/TelegramSyncState");

const IST = (d) =>
    new Date(d || Date.now()).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

const syncLog = (msg) => console.log(`[Telegram Sync] [${IST()}] ${msg}`);

const BACKFILL_LIMIT = 200; // Max messages per channel per startup

/**
 * Emits sync progress/status via Socket.IO.
 * Graceful: never crashes if socket is not ready.
 */
const emitSyncEvent = (event, payload) => {
    try {
        const socketService = require("./socketService");
        socketService.broadcast(event, payload);
    } catch (e) { /* socket not ready */ }
};

/**
 * Main backfill entry point.
 * Called once after GramJS connects successfully.
 * @param {import("telegram").TelegramClient} client
 */
const runBackfill = async (client) => {
    const { processMessageContent } = require("./telegramService");

    // Let's check the actual client's authorization status
    let isAuth = false;
    try {
        isAuth = await client.isUserAuthorized();
        syncLog(`Client authorization status: ${isAuth}`);
        if (isAuth) {
            syncLog(`Current session string (first 10 chars): ${client.session.save().substring(0, 10)}...`);
        }
    } catch (err) {
        syncLog(`Failed to check authorization: ${err.message}`);
    }

    if (!isAuth) {
        syncLog("========================================");
        syncLog("⚠ BACKFILL SKIPPED: The provided TelegramClient is NOT authorized.");
        syncLog("  GramJS is connected using an anonymous session.");
        syncLog("  Backfill requires a fully authenticated session to fetch history.");
        syncLog("  To fix: run 'node scripts/generateSession.js'");
        syncLog("  Copy the output into .env as TELEGRAM_SESSION=<string>");
        syncLog("========================================");
        emitSyncEvent("telegram:sync:complete", {
            completedAt: new Date(),
            totalScanned: 0, totalSkipped: 0, totalJobsExtracted: 0,
            totalMatched: 0, totalRejected: 0, totalDuplicates: 0, totalErrors: 0,
            skippedReason: "TelegramClient is not authorized",
        });
        return;
    }

    const channels = await TelegramChannel.find({ enabled: true }).lean();
    if (!channels || channels.length === 0) {
        syncLog("No monitored channels found — backfill skipped.");
        return;
    }

    syncLog(`Starting historical synchronization for ${channels.length} channel(s).`);
    emitSyncEvent("telegram:sync:start", {
        channels: channels.map((c) => c.username),
        startedAt: new Date(),
    });

    // Pre-load dialogs so that GramJS has all channel entities cached.
    // This avoids AUTH_KEY_UNREGISTERED from contacts.ResolveUsername.
    let dialogMap = {}; // username.lower -> InputPeer
    try {
        syncLog("Loading dialogs to warm entity cache...");
        const dialogs = await client.getDialogs({ limit: 200 });
        for (const dialog of dialogs) {
            const entity = dialog.entity;
            if (entity && entity.username) {
                dialogMap[entity.username.toLowerCase()] = dialog.inputEntity;
            }
        }
        syncLog(`  Entity cache warmed: ${Object.keys(dialogMap).length} entities loaded.`);
    } catch (e) {
        syncLog(`  WARN: Could not warm entity cache: ${e.message}`);
    }

    const globalStats = {
        totalScanned: 0,
        totalSkipped: 0,
        totalJobsExtracted: 0,
        totalMatched: 0,
        totalRejected: 0,
        totalDuplicates: 0,
        totalErrors: 0,
    };

    for (const channel of channels) {
        const channelStats = await processChannel(client, channel, processMessageContent, dialogMap);
        globalStats.totalScanned      += channelStats.scanned;
        globalStats.totalSkipped      += channelStats.skipped;
        globalStats.totalJobsExtracted+= channelStats.jobsExtracted;
        globalStats.totalMatched      += channelStats.matched;
        globalStats.totalRejected     += channelStats.rejected;
        globalStats.totalDuplicates   += channelStats.duplicates;
        globalStats.totalErrors       += channelStats.errors;
    }

    syncLog("========================================");
    syncLog("Sync Complete");
    syncLog(`  Channels       : ${channels.length}`);
    syncLog(`  Messages scanned  : ${globalStats.totalScanned}`);
    syncLog(`  Messages skipped  : ${globalStats.totalSkipped}`);
    syncLog(`  Jobs extracted    : ${globalStats.totalJobsExtracted}`);
    syncLog(`  Matched jobs      : ${globalStats.totalMatched}`);
    syncLog(`  Rejected jobs     : ${globalStats.totalRejected}`);
    syncLog(`  Duplicates skipped: ${globalStats.totalDuplicates}`);
    syncLog(`  Errors            : ${globalStats.totalErrors}`);
    syncLog("========================================");

    emitSyncEvent("telegram:sync:complete", {
        completedAt: new Date(),
        ...globalStats,
    });

    // Refresh dashboard after sync
    try {
        const socketService = require("./socketService");
        await socketService.emitDashboard();
        
        // Trigger batch email for historical sync
        const emailService = require("./emailService");
        await emailService.processBatchEmail();
    } catch (e) {
        syncLog(`  WARN: Error during post-sync processes: ${e.message}`);
    }
};

/**
 * Process one channel: fetch history, call pipeline for each unseen message.
 */
const processChannel = async (client, channel, processMessageContent, dialogMap = {}) => {
    const stats = {
        scanned: 0,
        skipped: 0,
        jobsExtracted: 0,
        matched: 0,
        rejected: 0,
        duplicates: 0,
        errors: 0,
    };

    const username = channel.username;
    syncLog(`Channel: @${username} — fetching sync state...`);

    // 1. Load or create sync state
    let syncState = await TelegramSyncState.findOne({ channelUsername: username.toLowerCase() });
    const isFirstRun = !syncState || syncState.lastProcessedMessageId === 0;

    const lastProcessedId = syncState?.lastProcessedMessageId || 0;
    syncLog(`  Last processed ID : ${lastProcessedId} (${isFirstRun ? "INITIAL BACKFILL" : "INCREMENTAL"})`);

    emitSyncEvent("telegram:sync:progress", {
        channel: username,
        phase: isFirstRun ? "initial_backfill" : "incremental",
        lastProcessedId,
    });

    // 2. Resolve channel entity
    // Prefer the pre-loaded dialogMap (already-known sessions) to avoid AUTH_KEY_UNREGISTERED.
    // Fall back to getInputEntity if not found in dialogs.
    let resolvedPeer = dialogMap[username.toLowerCase()] || null;
    if (resolvedPeer) {
        syncLog(`  Peer resolved from dialog cache.`);
    } else {
        syncLog(`  @${username} not in dialog cache — trying getInputEntity...`);
        try {
            resolvedPeer = await client.getInputEntity(username.toLowerCase());
        } catch (e1) {
            try {
                resolvedPeer = await client.getInputEntity(`@${username}`);
            } catch (e2) {
                syncLog(`  WARN: Cannot resolve @${username} — backfill skipped.`);
                syncLog(`  Reason: ${e2.message}`);
                syncLog(`  FIX: Ensure the Telegram account has joined @${username} and refresh the session.`);
                stats.errors++;
                return stats;
            }
        }
    }

    // 3. Fetch messages from Telegram history
    let messages = [];
    try {
        for await (const msg of client.iterMessages(resolvedPeer, {
            limit: BACKFILL_LIMIT,
            ...(lastProcessedId > 0 ? { minId: lastProcessedId } : {}),
        })) {
            if (msg && msg.message) {
                messages.push(msg);
            }
        }
    } catch (fetchErr) {
        syncLog(`  ERROR fetching history for @${username}: ${fetchErr.message}`);
        stats.errors++;
        return stats;
    }

    syncLog(`  Messages fetched  : ${messages.length}`);

    if (messages.length === 0) {
        syncLog(`  No new messages — skipping.`);
        return stats;
    }

    // 3. Sort oldest → newest so we process in chronological order
    messages.sort((a, b) => a.id - b.id);

    let newestProcessedId = lastProcessedId;

    for (const msg of messages) {
        stats.scanned++;

        // Guard: never reprocess
        if (msg.id <= lastProcessedId) {
            stats.skipped++;
            continue;
        }

        syncLog(`  Processing MsgID ${msg.id} (${IST(new Date(msg.date * 1000))})`);

        emitSyncEvent("telegram:sync:progress", {
            channel: username,
            messageId: msg.id,
            scanned: stats.scanned,
            jobsExtracted: stats.jobsExtracted,
        });

        try {
            // Extract entity URLs
            const entities = msg.entities || [];

            // Call the SAME pipeline used by live listener
            // silent=true suppresses verbose stage banners in batch mode
            const result = await processMessageContent(
                msg.message || "",
                entities,
                username,
                msg.id,
                { silent: true }
            );

            if (result) {
                stats.jobsExtracted += result.jobCount || 0;
                stats.matched       += result.matched ? 1 : 0;
                stats.rejected      += (!result.matched && result.jobCount > 0) ? 1 : 0;

                if (result.jobCount > 0) {
                    syncLog(`  ✅ MsgID ${msg.id}: ${result.jobCount} job(s) extracted, ${result.matchCount || 0} matched`);

                    emitSyncEvent("telegram:newJob", {
                        channel: username,
                        messageId: msg.id,
                        jobs: result.processedJobs || [],
                    });
                } else {
                    syncLog(`  ⬜ MsgID ${msg.id}: Not a job or no extractable URL`);
                }
            }
        } catch (msgErr) {
            syncLog(`  ERROR on MsgID ${msg.id}: ${msgErr.message}`);
            stats.errors++;
        }

        // Always advance the cursor, even if processing failed
        if (msg.id > newestProcessedId) {
            newestProcessedId = msg.id;
        }
    }

    // 4. Save sync state — upsert so Azure restarts resume from here
    try {
        const updatePayload = {
            channelUsername: username.toLowerCase(),
            channelId: channel._id ? channel._id.toString() : username,
            lastProcessedMessageId: newestProcessedId,
            lastProcessedDate: new Date(),
            lastSyncTime: new Date(),
            $inc: {
                totalMessagesScanned: stats.scanned,
                totalJobsExtracted:   stats.jobsExtracted,
                totalJobsMatched:     stats.matched,
                totalJobsRejected:    stats.rejected,
                totalDuplicates:      stats.duplicates,
                totalErrors:          stats.errors,
            },
        };

        // findOneAndUpdate doesn't support $set + $inc together cleanly — split
        const existing = await TelegramSyncState.findOne({ channelUsername: username.toLowerCase() });
        if (existing) {
            existing.lastProcessedMessageId = newestProcessedId;
            existing.lastProcessedDate = new Date();
            existing.lastSyncTime = new Date();
            existing.totalMessagesScanned = (existing.totalMessagesScanned || 0) + stats.scanned;
            existing.totalJobsExtracted   = (existing.totalJobsExtracted   || 0) + stats.jobsExtracted;
            existing.totalJobsMatched     = (existing.totalJobsMatched     || 0) + stats.matched;
            existing.totalJobsRejected    = (existing.totalJobsRejected    || 0) + stats.rejected;
            existing.totalDuplicates      = (existing.totalDuplicates      || 0) + stats.duplicates;
            existing.totalErrors          = (existing.totalErrors           || 0) + stats.errors;
            await existing.save();
        } else {
            await TelegramSyncState.create({
                channelId: channel._id ? channel._id.toString() : username,
                channelUsername: username.toLowerCase(),
                lastProcessedMessageId: newestProcessedId,
                lastProcessedDate: new Date(),
                lastSyncTime: new Date(),
                totalMessagesScanned: stats.scanned,
                totalJobsExtracted:   stats.jobsExtracted,
                totalJobsMatched:     stats.matched,
                totalJobsRejected:    stats.rejected,
                totalDuplicates:      stats.duplicates,
                totalErrors:          stats.errors,
            });
        }

        syncLog(`  Sync state saved  : lastProcessedMessageId=${newestProcessedId}`);
    } catch (saveErr) {
        syncLog(`  ERROR saving sync state: ${saveErr.message}`);
    }

    // 5. Per-channel summary
    syncLog(`  ── Channel Summary: @${username} ──`);
    syncLog(`     Scanned   : ${stats.scanned}`);
    syncLog(`     Skipped   : ${stats.skipped}`);
    syncLog(`     Jobs      : ${stats.jobsExtracted}`);
    syncLog(`     Matched   : ${stats.matched}`);
    syncLog(`     Rejected  : ${stats.rejected}`);
    syncLog(`     Errors    : ${stats.errors}`);
    syncLog(`     Last ID   : ${newestProcessedId}`);

    return stats;
};

/**
 * Returns sync state for all channels (for dashboard/API).
 */
const getSyncStatus = async () => {
    const states = await TelegramSyncState.find({}).lean();
    return states;
};

module.exports = { runBackfill, getSyncStatus };
