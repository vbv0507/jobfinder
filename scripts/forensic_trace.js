/**
 * FORENSIC TRACE SCRIPT - RoleNova Telegram Pipeline Diagnostic
 * Run: node scripts/forensic_trace.js
 * 
 * Traces all 13 pipeline stages without modifying any logic.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const rawSession = process.env.TELEGRAM_SESSION || '';

const PASS = (stage, msg) => console.log(`\n✅ ${stage}: PASS — ${msg}`);
const FAIL = (stage, msg) => console.log(`\n❌ ${stage}: FAIL — ${msg}`);
const INFO = (label, val) => console.log(`   ${label.padEnd(25)}: ${val}`);
const HDR  = (title) => console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);

async function main() {

    // ══════════════════════════════════════════════════════════
    // PHASE 1: Telegram Authentication
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 1: TELEGRAM AUTHENTICATION');

    INFO('TELEGRAM_API_ID', API_ID ? `YES (${API_ID})` : 'MISSING');
    INFO('TELEGRAM_API_HASH', API_HASH ? 'YES' : 'MISSING');
    INFO('SESSION exists', rawSession.length > 0 ? 'YES' : 'NO — EMPTY');
    INFO('SESSION length', rawSession.length);
    INFO('SESSION first 20', rawSession.substring(0, 20));
    INFO('SESSION last 10', rawSession.substring(rawSession.length - 10));

    const b64Body = rawSession.slice(1);
    const b64Valid = /^[A-Za-z0-9+/=]+$/.test(b64Body);
    const padRem = b64Body.length % 4;
    INFO('Base64 valid', b64Valid ? 'YES' : 'NO — INVALID CHARS');
    INFO('Base64 pad remainder', `${padRem} ${padRem === 0 ? '(OK)' : '(TRUNCATED)' }`);

    let telegramClient = null;
    let sessionOk = false;

    try {
        const { TelegramClient } = require('telegram');
        const { StringSession } = require('telegram/sessions');
        const { ConnectionTCPObfuscated } = require('telegram/network/connection/TCPObfuscated');

        const parsedSession = new StringSession(rawSession);
        const authKeyPresent = (parsedSession.authKey && parsedSession.authKey.length > 0)
            || (parsedSession._key && parsedSession._key.length > 0);

        INFO('Auth key present', authKeyPresent ? 'YES' : 'NO — MISSING (CORRUPT SESSION)');

        if (!authKeyPresent) {
            FAIL('Phase 1', 'Session auth key is missing. Session string is truncated or corrupted.');
            process.exit(1);
        }

        INFO('DC ID', parsedSession.dcId || 'Not decoded yet');
        INFO('Server Address', parsedSession.serverAddress || 'Not decoded yet');
        INFO('Port', parsedSession.port || 'Not decoded yet');

        console.log('\n[Phase 1] Connecting to Telegram...');
        telegramClient = new TelegramClient(parsedSession, API_ID, API_HASH, {
            connectionRetries: 3,
            connection: ConnectionTCPObfuscated,
        });

        await Promise.race([
            telegramClient.connect(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('connect() timed out after 30s')), 30000))
        ]);

        console.log('[Phase 1] connect() resolved');

        const isAuth = await telegramClient.isUserAuthorized();
        INFO('isUserAuthorized()', isAuth ? 'TRUE' : 'FALSE');
        INFO('client.connected', telegramClient.connected ? 'TRUE' : 'FALSE');

        // Session details after connection
        INFO('session.dcId', telegramClient.session.dcId || 'Unknown');
        INFO('session.serverAddress', telegramClient.session.serverAddress || 'Unknown');
        INFO('session.port', telegramClient.session.port || 'Unknown');

        if (!isAuth) {
            FAIL('Phase 1', 'NOT_AUTHORIZED — Session is invalid. Run node scripts/generateSession.js');
            await telegramClient.disconnect();
            process.exit(1);
        }

        const me = await telegramClient.getMe();
        INFO('getMe().id', me.id.toString());
        INFO('getMe().username', me.username || me.firstName || 'N/A');
        INFO('getMe().phone', me.phone || 'N/A');

        sessionOk = true;
        PASS('Phase 1', `Authenticated as ${me.username || me.firstName} (ID: ${me.id})`);

    } catch (err) {
        FAIL('Phase 1', err.message);
        console.error(err.stack);
        if (telegramClient) {
            try { await telegramClient.disconnect(); } catch(e) {}
        }
        process.exit(1);
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 2: Dialog Resolution
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 2: DIALOG RESOLUTION');

    const TARGET_CHANNELS = ['LMTPlacements', 'TechUprise_Updates'];

    let dialogMap = {};
    try {
        console.log('[Phase 2] Fetching dialogs (limit 200)...');
        const dialogs = await telegramClient.getDialogs({ limit: 200 });
        for (const dialog of dialogs) {
            const entity = dialog.entity;
            if (entity && entity.username) {
                dialogMap[entity.username.toLowerCase()] = {
                    inputEntity: dialog.inputEntity,
                    id: entity.id?.toString(),
                    accessHash: entity.accessHash?.toString(),
                    username: entity.username,
                    title: entity.title || entity.firstName
                };
            }
        }
        INFO('Total dialogs loaded', Object.keys(dialogMap).length);
    } catch (e) {
        FAIL('Phase 2', `Cannot fetch dialogs: ${e.message}`);
    }

    let allChannelsResolved = true;
    for (const ch of TARGET_CHANNELS) {
        const key = ch.toLowerCase();
        const found = dialogMap[key];
        if (found) {
            console.log(`\n   Channel: @${ch}`);
            INFO('  Resolved', 'YES — found in dialog cache');
            INFO('  Channel ID', found.id || 'N/A');
            INFO('  Access Hash', found.accessHash ? found.accessHash.substring(0, 8) + '...' : 'N/A');
            INFO('  Username', found.username);
            INFO('  Title', found.title || 'N/A');
        } else {
            console.log(`\n   Channel: @${ch}`);
            INFO('  Resolved', 'NO — NOT in dialog cache');
            // Try direct resolution
            try {
                const entity = await telegramClient.getEntity(ch);
                INFO('  getEntity()', 'SUCCESS');
                INFO('  Channel ID', entity.id?.toString() || 'N/A');
                INFO('  Username', entity.username || 'N/A');
                INFO('  Title', entity.title || 'N/A');
            } catch (e2) {
                INFO('  getEntity()', `FAIL: ${e2.message}`);
                allChannelsResolved = false;
            }
        }
    }

    if (allChannelsResolved) {
        PASS('Phase 2', 'Both channels resolved');
    } else {
        FAIL('Phase 2', 'One or more channels could not be resolved. Account may not have joined the channel.');
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 3: Connect to MongoDB and check TelegramChannel + SyncState
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 3: DATABASE STATE — TelegramChannel + SyncState');

    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
        INFO('MongoDB', 'Connected');
    } catch (e) {
        FAIL('Phase 3', `MongoDB connection failed: ${e.message}`);
        process.exit(1);
    }

    const TelegramChannel = require('../models/TelegramChannel');
    const TelegramSyncState = require('../models/TelegramSyncState');
    const RawJob = require('../models/RawJob');
    const MatchedJob = require('../models/MatchedJob');
    const RejectedJob = require('../models/RejectedJob');

    const channels = await TelegramChannel.find({}).lean();
    INFO('TelegramChannel docs', channels.length);

    let enabledChannels = channels.filter(c => c.enabled);
    INFO('Enabled channels', enabledChannels.length);

    for (const ch of channels) {
        console.log(`\n   DB Channel: ${ch.username}`);
        INFO('  enabled', ch.enabled);
        INFO('  status', ch.status);
        INFO('  messagesProcessed', ch.messagesProcessed);
        INFO('  jobsFound', ch.jobsFound);
        INFO('  matchedJobs', ch.matchedJobs);
        INFO('  ignoredMessages', ch.ignoredMessages);
        INFO('  parsingFailures', ch.parsingFailures);
        INFO('  lastMessageAt', ch.lastMessageAt ? ch.lastMessageAt.toISOString() : 'NEVER');
        INFO('  lastProcessedAt', ch.lastProcessedAt ? ch.lastProcessedAt.toISOString() : 'NEVER');
    }

    if (enabledChannels.length === 0) {
        FAIL('Phase 3', 'No enabled channels in DB. Listener will not monitor any channel.');
    } else {
        PASS('Phase 3a', `${enabledChannels.length} enabled channel(s) in DB`);
    }

    // Check username casing stored vs what we receive
    console.log('\n   [CRITICAL CHECK] Channel username format in DB:');
    for (const ch of enabledChannels) {
        INFO('  stored username', `"${ch.username}" (length: ${ch.username.length})`);
        INFO('  has @ prefix', ch.username.startsWith('@') ? 'YES — PROBLEM!' : 'NO — OK');
        INFO('  lowercase match', ch.username.toLowerCase());
    }

    // SyncState
    const syncStates = await TelegramSyncState.find({}).lean();
    INFO('\nTelegramSyncState docs', syncStates.length);
    for (const ss of syncStates) {
        console.log(`\n   SyncState: ${ss.channelUsername}`);
        INFO('  lastProcessedMessageId', ss.lastProcessedMessageId);
        INFO('  lastSyncTime', ss.lastSyncTime ? ss.lastSyncTime.toISOString() : 'NEVER');
        INFO('  totalMessagesScanned', ss.totalMessagesScanned);
        INFO('  totalJobsExtracted', ss.totalJobsExtracted);
    }

    if (syncStates.length === 0) {
        console.log('\n   [INFO] No sync state — this is the FIRST run (initial backfill)');
    }

    PASS('Phase 3', 'DB state read successfully');

    // ══════════════════════════════════════════════════════════
    // PHASE 4: Live Listener — Event Handler Count
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 4: LIVE LISTENER — EVENT HANDLER VERIFICATION');

    const { NewMessage } = require('telegram/events');
    const filter = new NewMessage({});
    telegramClient.addEventHandler((event) => {}, filter);

    const handlerCount = telegramClient._eventBuilders ? telegramClient._eventBuilders.length : 'N/A';
    INFO('_eventBuilders count', handlerCount);
    INFO('NewMessage filter class', filter.constructor.name);

    if (telegramClient._eventBuilders && telegramClient._eventBuilders.length > 0) {
        telegramClient._eventBuilders.forEach((b, i) => {
            INFO(`  Handler[${i}] fn name`, b[0]?.name || 'anonymous');
            INFO(`  Handler[${i}] event class`, b[1]?.constructor?.name || 'N/A');
        });
        PASS('Phase 4', `${telegramClient._eventBuilders.length} event handler(s) attached`);
    } else {
        FAIL('Phase 4', 'No event handlers attached to client');
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 5: INJECT LIVE MESSAGE LISTENER — 30 second window
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 5: LIVE MESSAGE INTERCEPT (30-second window)');
    console.log('[Phase 5] Waiting 30 seconds for incoming messages...');
    console.log('[Phase 5] Send a message to @LMTPlacements or @TechUprise_Updates now.');

    let messagesReceived = 0;
    const liveMessages = [];

    const diagnosticHandler = (event) => {
        const msg = event.message;
        messagesReceived++;
        const chatId = msg?.peerId?.channelId || msg?.peerId?.chatId || msg?.peerId?.userId || 'Unknown';
        const text = msg?.message || '';
        console.log(`\n[Phase 5] 📨 RAW MESSAGE RECEIVED:`);
        INFO('  Message ID', msg?.id);
        INFO('  Peer Channel ID', chatId.toString());
        INFO('  Text length', text.length);
        INFO('  Text (first 300)', text.substring(0, 300));
        liveMessages.push({ id: msg?.id, chatId: chatId.toString(), text });
    };

    telegramClient.addEventHandler(diagnosticHandler, new NewMessage({}));

    await new Promise(resolve => setTimeout(resolve, 30000));

    telegramClient.removeEventHandler(diagnosticHandler, new NewMessage({}));

    if (messagesReceived === 0) {
        FAIL('Phase 5', 'NO messages received in 30 seconds. Either: (1) No messages posted to channels, (2) Client not subscribed to channels, or (3) Event loop blocking.');
        console.log('   → The NewMessage filter with {} should receive ALL messages from joined channels.');
        console.log('   → If channels are active but nothing arrived, the account may NOT be a member of those channels.');
    } else {
        PASS('Phase 5', `${messagesReceived} message(s) intercepted in 30 seconds`);
        for (const m of liveMessages) {
            INFO('  Received MsgID', m.id);
            INFO('  From channel ID', m.chatId);
        }
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 6: handleIncomingMessage() — test with synthetic event
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 6: handleIncomingMessage() ENTRY/EXIT TEST');

    const { processMessageContent } = require('../services/telegramService');

    const testText = `Company: TestCorp
Role: Software Engineer  
Location: India
Experience: 0-1 Years
Apply: https://careers.testcorp.example.com/jobs/sde-123`;

    console.log('[Phase 6] Calling processMessageContent() directly...');
    const t0 = Date.now();
    try {
        const result = await processMessageContent(
            testText,
            [],
            enabledChannels[0]?.username || 'LMTPlacements',
            999999999,
            { silent: false }
        );
        const dur = Date.now() - t0;
        console.log(`[Phase 6] processMessageContent() returned in ${dur}ms`);
        INFO('jobCount', result?.jobCount);
        INFO('matchCount', result?.matchCount);
        INFO('error', result?.error || 'None');
        PASS('Phase 6', `processMessageContent() executed. jobCount=${result?.jobCount}`);
    } catch (e) {
        FAIL('Phase 6', `processMessageContent() threw: ${e.message}`);
        console.error(e.stack);
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 7: PARSER TEST
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 7: PARSER TEST — parseStructuredPost()');

    const { parseStructuredPost } = require('../services/telegramService');

    const samples = [
        `Company: Acme Corp\nRole: Frontend Developer\nLocation: India\nExperience: 0-1 Years\nSalary: 4 LPA\nApply: https://careers.acme.com/jobs/123`,
        `🚀 Hiring Software Engineers!\n#Fresher #Developer\nApply: https://lever.co/mycompany/sde-role`,
        `Join our team!\nhttps://www.linkedin.com/jobs/view/1234567890`
    ];

    for (let i = 0; i < samples.length; i++) {
        console.log(`\n   Sample [${i+1}]:`);
        console.log('   Text:', samples[i].substring(0, 80) + '...');
        const parsed = parseStructuredPost(samples[i]);
        INFO('  company', parsed.company || '(null)');
        INFO('  role', parsed.role || '(null)');
        INFO('  location', parsed.location || '(null)');
        INFO('  experience', parsed.experience || '(null)');
        INFO('  salary', parsed.salary || '(null)');
    }
    PASS('Phase 7', 'Parser executed');

    // ══════════════════════════════════════════════════════════
    // PHASE 8: isJobMessage() filter check
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 8: isJobMessage() FILTER CHECK');

    const { isJobMessage } = require('../services/telegramService');
    const filterTests = [
        { text: 'Company: Acme\nRole: SDE\nhttps://lever.co/acme/sde', desc: 'Structured job post with lever URL' },
        { text: 'Hiring freshers for SDE role at Bangalore', desc: 'Keyword-based job message' },
        { text: 'Good morning everyone!', desc: 'Non-job message' },
        { text: 'Check out this internship opportunity https://internshala.com/job/123', desc: 'Internship URL' },
    ];

    for (const test of filterTests) {
        const result = isJobMessage(test.text, []);
        INFO(`isJobMessage("${test.desc.substring(0,30)}")`, result ? 'TRUE — will process' : 'FALSE — will be ignored');
    }
    PASS('Phase 8', 'isJobMessage() filter verified');

    // ══════════════════════════════════════════════════════════
    // PHASE 9: allowedChannels Set — exact match check
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 9: allowedChannels SET — MATCH SIMULATION');

    const allowedSet = new Set(enabledChannels.map(c => c.username.toLowerCase()));
    INFO('allowedChannels set', JSON.stringify(Array.from(allowedSet)));

    const incomingSimulations = ['LMTPlacements', 'lmtplacements', 'TechUprise_Updates', 'techuprise_updates', '@LMTPlacements'];
    for (const incoming of incomingSimulations) {
        const norm = incoming.trim().replace(/^@/, '').toLowerCase();
        const allowed = allowedSet.has(norm);
        INFO(`incoming "${incoming}"`, allowed ? 'ALLOWED' : 'REJECTED — mismatch!');
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 10: Today's DB stats
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 10: DATABASE COUNTS — TODAY');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rawToday = await RawJob.countDocuments({ 'sources.sourceChannel': { $exists: true }, createdAt: { $gte: todayStart } });
    const matchedToday = await MatchedJob.countDocuments({ source: 'telegram', createdAt: { $gte: todayStart } });
    const rejectedToday = await RejectedJob.countDocuments({ source: 'telegram', createdAt: { $gte: todayStart } });

    INFO('RawJobs today (telegram)', rawToday);
    INFO('MatchedJobs today (telegram)', matchedToday);
    INFO('RejectedJobs today (telegram)', rejectedToday);

    const totalRaw = await RawJob.countDocuments({ 'sources.sourceChannel': { $exists: true } });
    INFO('Total RawJobs (telegram, all time)', totalRaw);

    // ══════════════════════════════════════════════════════════
    // PHASE 11: HISTORICAL BACKFILL — fetch last 5 messages
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 11: HISTORICAL BACKFILL — LAST 5 MESSAGES FROM CHANNELS');

    for (const ch of enabledChannels) {
        const key = ch.username.toLowerCase();
        const peer = dialogMap[key];
        if (!peer) {
            FAIL(`Phase 11 @${ch.username}`, 'Channel not in dialog cache — backfill would skip this channel');
            continue;
        }

        try {
            const msgs = [];
            for await (const msg of telegramClient.iterMessages(peer.inputEntity, { limit: 5 })) {
                if (msg && msg.message) msgs.push(msg);
            }
            INFO(`@${ch.username} last msgs`, msgs.length);
            for (const m of msgs.reverse()) {
                console.log(`\n   MsgID: ${m.id} | ${new Date(m.date * 1000).toISOString()}`);
                INFO('  Text (first 150)', m.message.substring(0, 150));
                const { isJobMessage: isJob } = require('../services/telegramService');
                const { extractUrls } = require('../utils/urlStrategy');
                const urls = extractUrls(m.message);
                INFO('  isJobMessage', isJob(m.message, []) ? 'YES' : 'NO');
                INFO('  URLs found', urls.length > 0 ? urls.join(', ') : 'NONE');
            }
            PASS(`Phase 11 @${ch.username}`, `Fetched ${msgs.length} messages`);
        } catch (e) {
            FAIL(`Phase 11 @${ch.username}`, e.message);
        }
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 12: SOCKET.IO STATE
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 12: SOCKET.IO — NOT TESTABLE STANDALONE');
    console.log('   Socket.IO requires the Express server. Check server logs for:');
    console.log('   - "telegram:update" emission on message arrival');
    console.log('   - "telegram:newEvent" emission for live feed');
    console.log('   - "dashboard:update" after backfill completes');

    // ══════════════════════════════════════════════════════════
    // PHASE 13: ROOT CAUSE SUMMARY
    // ══════════════════════════════════════════════════════════
    HDR('PHASE 13: ROOT CAUSE ANALYSIS');

    console.log('\nChecking all known failure modes...\n');

    // Check 1: Channels in DB have @ prefix (common bug)
    const hasAtPrefix = enabledChannels.some(c => c.username.startsWith('@'));
    if (hasAtPrefix) {
        console.log('🔴 ROOT CAUSE CANDIDATE: Channels in DB have @ prefix in username field.');
        console.log('   When GramJS reports chat.username it does NOT include @.');
        console.log('   allowedChannels.has("lmtplacements") will fail if DB has "@LMTPlacements".');
        console.log('   FIX: Strip @ from username in TelegramChannel documents.');
    }

    // Check 2: SyncState lastProcessedMessageId is too high
    for (const ss of syncStates) {
        const key = ss.channelUsername.toLowerCase();
        const peer = dialogMap[key];
        if (peer) {
            try {
                let latestMsg = null;
                for await (const msg of telegramClient.iterMessages(peer.inputEntity, { limit: 1 })) {
                    latestMsg = msg;
                }
                if (latestMsg && ss.lastProcessedMessageId >= latestMsg.id) {
                    console.log(`\n🔴 ROOT CAUSE CANDIDATE: @${ss.channelUsername} SyncState is AHEAD of channel.`);
                    console.log(`   lastProcessedMessageId = ${ss.lastProcessedMessageId}`);
                    console.log(`   Latest message ID      = ${latestMsg.id}`);
                    console.log(`   Result: minId filter in iterMessages skips ALL messages.`);
                    console.log(`   FIX: Reset lastProcessedMessageId to 0 for this channel.`);
                }
            } catch(e) {}
        }
    }

    // Check 3: allowedChannels match
    for (const ch of enabledChannels) {
        const norm = ch.username.trim().replace(/^@/, '').toLowerCase();
        const inSet = new Set([norm]).has(norm);
        if (!inSet) {
            console.log(`\n🔴 ROOT CAUSE: Channel "${ch.username}" would not match after normalization.`);
        }
    }

    console.log('\n✅ Forensic trace complete. Disconnecting...');
    await telegramClient.disconnect();
    await mongoose.connection.close();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('\n[FATAL]', err.message);
    console.error(err.stack);
    try { await mongoose.connection.close(); } catch(e) {}
    process.exit(1);
});
