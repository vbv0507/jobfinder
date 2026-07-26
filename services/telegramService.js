const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { normalizeJobUrl } = require("../utils/urlNormalizer");
const { withLogContext } = require("../utils/logger");

const Company = require("../models/Company");
const CandidateProfile = require("../models/CandidateProfile");
const TelegramChannel = require("../models/TelegramChannel");

const { extractUrls, getUrlStrategy } = require("../utils/urlStrategy");
const {
    saveRawJob,
    saveMatchedJob
} = require("../services/pipeline/storageService");
const { analyseWithGemini, getActiveProfile } = require("../services/pipeline/aiEvaluationService");
const { sendMatchedJobEmail } = require("./emailService");
const { saveTrainingSample } = require("./trainingDatasetService");

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;

const mongoose = require("mongoose");
const { execSync } = require("child_process");
const PipelineLock = require("../models/PipelineLock");
const pipelineState = require("./pipelineState");


const logWithTime = (msg) => {
    const time = new Date().toTimeString().split(" ")[0];
    console.log(`[${time}] ${msg}`);
};

let telegramClient = null;
let listenerStatus = { status: "Not Started", lastJobMessageAt: null, lastHealthCheckAt: null, layer: "Unknown", dc: "Unknown", uptimeStart: null, monitoredChannels: [], reconnects: 0 };
let isReconnecting = false;
let isStarting = false;
let reconnectDelay = 5000;
let allowedChannels = new Set();
let messagesReceivedSinceStartup = 0;

const emitTelegramSnapshot = async (lastMessage = null) => {
    try {
        const socketService = require("./socketService");
        const channels = await TelegramChannel.find({ enabled: true }).sort({ priority: 1, name: 1 }).lean();
        socketService.emitTelegram({
            connected: listenerStatus.status === "Connected",
            monitoredChannels: listenerStatus.monitoredChannels || channels.map((channel) => channel.username),
            channels,
            messagesProcessed: channels.reduce((sum, channel) => sum + (channel.messagesProcessed || 0), 0),
            jobsFound: channels.reduce((sum, channel) => sum + (channel.jobsFound || 0), 0),
            matchedJobs: channels.reduce((sum, channel) => sum + (channel.matchedJobs || 0), 0),
            deliveryErrors: channels.reduce((sum, channel) => sum + (channel.errorCount || 0), 0),
            lastMessageAt: listenerStatus.lastJobMessageAt,
            lastMessage
        });
    } catch (error) {
        console.log(`[Telegram] Socket update skipped: ${error.message}`);
    }
};

const loadChannels = async () => {
    const channels = await TelegramChannel.find({ enabled: true });
    allowedChannels = new Set(channels.map(c => c.username.toLowerCase()));
    listenerStatus.monitoredChannels = channels.map(c => c.username);
    await TelegramChannel.updateMany({ enabled: true }, { $set: { status: "Online" } });
};

const isJobMessage = (text = "", urls = []) => {
    const lower = text.toLowerCase();
    const hasKeywords = /\b(company|role|apply|hiring|intern|internship|fresher|sde|developer|engineer|opening|job|position)\b/i.test(lower);
    if (hasKeywords) return true;

    
    const allUrls = [...extractUrls(text), ...urls];
    for (const url of allUrls) {
        if (getUrlStrategy(url) !== null) {
            return true;
        }
    }
    
    return false;
};

const parseStructuredPost = (text = "") => {
    const lines = text.split('\n');
    let company, role, experience, location, salary, type;

    
    const matchLine = (regex) => {
        const m = lines.find(l => regex.test(l));
        return m ? m.match(regex)[1]?.trim() : null;
    };

    
    company = matchLine(/(?:Company|Employer|Organization)[\s:]+([^\n*]+)/i) || text.match(/(?:Company|Employer|Organization)[\s:]+([^\n*]+)/i)?.[1]?.trim();
    role = matchLine(/(?:Role|Profile|Position|Title)[\s:]+([^\n*]+)/i) || text.match(/(?:Role|Profile|Position|Title)[\s:]+([^\n*]+)/i)?.[1]?.trim();
    experience = matchLine(/(?:Experience|Exp)[\s:]+([^\n*]+)/i) || text.match(/(?:Experience|Exp)[\s:]+([^\n*]+)/i)?.[1]?.trim();
    location = matchLine(/(?:Location|Job Location)[\s:]+([^\n*]+)/i) || text.match(/(?:Location|Job Location)[\s:]+([^\n*]+)/i)?.[1]?.trim();
    salary = matchLine(/(?:Salary|Stipend|CTC|Package)[\s:]+([^\n*]+)/i) || text.match(/(?:Salary|Stipend|CTC|Package)[\s:]+([^\n*]+)/i)?.[1]?.trim();
    type = matchLine(/(?:Type|Employment Type)[\s:]+([^\n*]+)/i) || text.match(/(?:Type|Employment Type)[\s:]+([^\n*]+)/i)?.[1]?.trim();
    
    
    const genericPhrases = /^(hiring|urgent hiring|frontend developers|developers|software engineers|apply now|freshers|immediate joiners|urgent|apply)$/i;
    
    if (company && genericPhrases.test(company)) {
        company = null; 
    }

    
    if (!role) {
        const firstLine = lines.find(l => l.trim().length > 3 && !/http/i.test(l) && !genericPhrases.test(l.trim()));
        if (firstLine && firstLine.length < 60) role = firstLine.replace(/[\*\_]/g, '').trim();
    }

    return {
        company: company || null,
        role: role || null,
        experience: experience || null,
        location: location || null,
        salary: salary || null,
        type: type || null,
    };
};

const scrapeGenericJobPage = async (url) => {
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
            },
            timeout: 15000,
        });

        const html = response.data || "";
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch?.[1]?.replace(/\s*[\|\-–]\s*.*/g, "")?.trim() || "Job Opening";

        const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
        const metaText = metaMatch?.[1] || "";
        const locationMatch = metaText.match(/\b(india|bangalore|bengaluru|noida|hyderabad|pune|remote|mumbai|chennai|gurugram)\b/i);
        const location = locationMatch?.[0] || "India";

        const bodyText = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 800);

        return {
            title,
            location,
            description: bodyText || title,
            applyLink: normalizeJobUrl(url),
            jobId: url.split("/").filter(Boolean).pop(),
            employmentType: /intern/i.test(title) ? "Internship" : "Full-Time",
        };
    } catch (error) {
        logWithTime(`Generic scrape failed for ${url}: ${error.message}`);
        return null;
    }
};

const processJobUrl = async (url, telegramCompany, profile, structuredData, sourceChannel, telegramMessageId) => {
    return await withLogContext({ pipelineId: "Telegram", jobUrl: url, company: telegramCompany?.name || "Unknown" }, async () => {
    let parsed = false;
    let matched = false;
    try {
        // ── STAGE 3: URL Strategy ────────────────────────────────────────────
        const strategy = getUrlStrategy(url);
        console.log(`\n  ┌─ URL: ${url}`);
        console.log(`  │  Strategy : ${strategy || "NONE"}`);

        if (!strategy) {
            console.log("  └─ STAGE 3 RESULT: Skipped (not a job URL)");
            logWithTime(`Skipped non-job URL: ${url}`);
            return { parsed, matched };
        }

        logWithTime(`Processing URL [${strategy}] from ${sourceChannel}: ${url}`);

        let job = null;

        if (strategy === "generic-html") {
            job = await scrapeGenericJobPage(url);
            if (job) {
                if (structuredData.experience) job.experience = structuredData.experience;
                if (structuredData.salary) job.salary = structuredData.salary;
                if (structuredData.type) job.employmentType = /intern/i.test(structuredData.type) ? "Internship" : "Full-Time";
            }
        } else {
            job = {
                title: structuredData.role || "Job Opening",
                location: structuredData.location || "India",
                description: structuredData.role || "Software Engineer role",
                experience: structuredData.experience || null,
                salary: structuredData.salary || null,
                applyLink: normalizeJobUrl(url),
                jobId: url.split("/").filter(Boolean).pop(),
                employmentType: /intern/i.test(structuredData.role || structuredData.type || "") ? "Internship" : "Full-Time",
            };
        }

        if (!job) {
            console.log("  └─ STAGE 3 RESULT: FAIL — scraper returned null");
            logWithTime(`Scraper returned null for URL: ${url}. Skipping.`);
            return { parsed, matched };
        }

        // company inference
        if (!structuredData.company) {
            try {
                const urlObj = new URL(url);
                const hostParts = urlObj.hostname.split('.');
                if (urlObj.hostname.includes('greenhouse') || urlObj.hostname.includes('lever')) {
                    const pathParts = urlObj.pathname.split('/').filter(Boolean);
                    if (pathParts.length > 0) job.inferredCompany = pathParts[0];
                } else if (hostParts.length > 2) {
                    job.inferredCompany = hostParts[0] !== 'www' ? hostParts[0] : hostParts[1];
                }
            } catch (e) {}
        }

        if (structuredData.role) job.title = structuredData.role;
        if (structuredData.company) job.description = `${structuredData.company} - ${job.description}`;

        job.sourceChannel = sourceChannel;
        job.telegramMessageId = telegramMessageId;
        job.sourceName = sourceChannel;

        // ── STAGE 3 cont.: Normalized Job ────────────────────────────────────
        console.log(`  │  title          : ${job.title}`);
        console.log(`  │  location       : ${job.location}`);
        console.log(`  │  experience     : ${job.experience || "N/A"}`);
        console.log(`  │  employmentType : ${job.employmentType}`);
        console.log(`  │  applyLink      : ${job.applyLink}`);
        console.log(`  │  inferredCompany: ${job.inferredCompany || "(from structured data)"}`);

        // ── STAGE 4: Validation ──────────────────────────────────────────────
        console.log(`  ├─ STAGE 4: Validation`);
        const checks = {
            hasApplyLink    : !!job.applyLink,
            startsWithHttps : !!job.applyLink?.startsWith('https://'),
            noUndefined     : !job.applyLink?.includes('undefined'),
            noNull          : !job.applyLink?.includes('null'),
            noLocalhost     : !job.applyLink?.toLowerCase().includes('localhost'),
        };
        for (const [rule, pass] of Object.entries(checks)) {
            console.log(`  │  ${pass ? "✅" : "❌"} ${rule}`);
        }

        const rawJob = await saveRawJob(telegramCompany, job);

        if (!rawJob) {
            console.log("  └─ STAGE 4 RESULT: ❌ FAIL — saveRawJob rejected (URL failed deep validation)");
            logWithTime(`[WARNING] Validation Failed: Rejected by saveRawJob`);
            return { parsed, matched };
        }

        console.log(`  │  ✅ PASS — RawJob _id: ${rawJob._id}`);
        console.log(`  │  aiEvaluated: ${rawJob.aiEvaluated}`);

        logWithTime(`[SUCCESS] Job Extracted and Validation Passed`);
        parsed = true;
        logWithTime(`[INFO] Job Parsed Successfully: ${job.title}`);

        if (rawJob.aiMatched) {
            console.log("  │  ℹ️  Already AI-matched — skipping re-evaluation");
            logWithTime(`[INFO] Already matched: ${job.title}`);
            return { parsed, matched };
        }

        // ── STAGE 5: Gemini AI Evaluation ───────────────────────────────────
        console.log("  ├─ STAGE 5: AI Evaluation");
        const aiState = { calls: 0, quotaExceeded: false };
        logWithTime(`[INFO] AI Evaluation Started (Gemini / Groq / Z.ai / Local)`);
        const result = await analyseWithGemini(job, profile, aiState);
        logWithTime(`[INFO] AI Evaluation Completed`);

        if (result.skipped) {
            console.log(`  │  ⚠️  SKIPPED: ${result.reason}`);
            logWithTime(`[WARNING] Skipped Gemini for ${job.title}: ${result.reason}`);
            return { parsed, matched };
        }

        const analysis = result.analysis;
        console.log(`  │  Provider       : ${analysis.provider || "gemini"}`);
        console.log(`  │  Score          : ${analysis.score}`);
        console.log(`  │  Suitable       : ${analysis.suitable}`);
        console.log(`  │  Confidence     : ${analysis.confidence}`);
        console.log(`  │  Reason         : ${analysis.reason}`);
        console.log(`  │  Matched Skills : ${(analysis.matchedSkills || []).join(", ") || "None"}`);
        console.log(`  │  Missing Skills : ${(analysis.missingSkills || []).join(", ") || "None"}`);
        console.log(`  │  Primary Reasons: ${(analysis.primaryReasons || []).join("; ") || "N/A"}`);
        const decision = analysis.score >= 70 ? "✅ MATCHED" : "❌ REJECTED";
        console.log(`  │  Decision       : ${decision} (threshold: 70)`);

        logWithTime(`[INFO] Gemini Score: ${analysis.score}`);
        if (analysis.score >= 70) {
            logWithTime(`[SUCCESS] AI Accepted`);
        } else {
            logWithTime(`[WARNING] AI Rejected`);
        }

        if (analysis) {
            saveTrainingSample(job, telegramCompany, analysis, "TelegramListener", "Telegram").catch(err => {
                logWithTime(`[WARNING] [TrainingDataset] Async save error: ${err.message}`);
            });
        }

        // ── STAGE 6: Storage ─────────────────────────────────────────────────
        console.log("  ├─ STAGE 6: Storage");
        const matchedJobResult = await saveMatchedJob(rawJob, telegramCompany, job, analysis);

        if (matchedJobResult && matchedJobResult.matched !== false) {
            console.log(`  │  ✅ MatchedJob written  (isDuplicate=${matchedJobResult.isDuplicate})`);
            logWithTime(`[SUCCESS] Matched Job Created: ${job.title}`);
            matched = true;
            try {
                await sendMatchedJobEmail({ company: telegramCompany, job, analysis });
                console.log("  │  📧 Email: Sent");
            } catch (emailError) {
                logWithTime(`Email failed: ${emailError.message}`);
                console.log("  │  📧 Email: Skipped");
            }
        } else {
            console.log(`  │  ❌ RejectedJob written (score=${analysis.score})`);
        }
        console.log(`  └─ STAGE 6 RESULT: Storage complete`);

        return { parsed, matched, job, result: analysis };
    } catch (error) {
        logWithTime(`Error processing URL ${url}: ${error.message}`);
        console.log(`[Telegram] Pipeline error: ${error.message}`);
        return { parsed: false, matched: false };
    }
    }); // End withLogContext
};

const handleIncomingMessage = async (event) => {
    messagesReceivedSinceStartup++;
    let chatUsername = "";
    try {
        const message = event.message;
        const istTimestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
        console.log("\n╔══════════════════════════════════════════════════╗");
        console.log("║   STAGE 1: GramJS NewMessage Received            ║");
        console.log("╚══════════════════════════════════════════════════╝");
        console.log(`  IST Timestamp : ${istTimestamp}`);
        console.log(`  Message ID    : ${message?.id || "Unknown"}`);
        console.log(`  Peer ID       : ${message?.peerId?.channelId || message?.peerId?.userId || message?.peerId?.chatId || "Unknown"}`);
        console.log(`  Event Class   : ${event.className || "Unknown"}`);
        console.log(`  Text Preview  : ${(message?.message || "").substring(0, 120)}`);
        console.log(`  Total Received: ${messagesReceivedSinceStartup}`);

        if (!message?.message) {
            console.log("RETURN REASON: - Empty message");
            return;
        }

        const text = message.message;

        // Telegram Health Check Intercept
        const healthEnabled = process.env.TELEGRAM_HEALTH_ENABLED === "true";
        const healthCommand = process.env.TELEGRAM_HEALTH_COMMAND || "#RN_HEALTH";
        const senderIdStr = message.senderId ? message.senderId.toString() : (message.fromId?.userId ? message.fromId.userId.toString() : "");

        if (healthEnabled && text === healthCommand) {
            console.log(`[Telegram] Health Command Received from ${senderIdStr}`);
            const allowedUsers = (process.env.TELEGRAM_HEALTH_ALLOWED_USERS || "").split(",").map(u => u.trim());
            if (allowedUsers.includes(senderIdStr)) {
                const receivedTime = new Date();
                listenerStatus.lastHealthCheckAt = new Date();
                listenerStatus.lastDiagnosticsUser = senderIdStr;
                
                // Gather Diagnostics
                let gitCommit = "Unknown";
                try {
                    gitCommit = execSync('git rev-parse --short HEAD').toString().trim();
                } catch (e) {}
                
                const appUptime = process.uptime();
                const hrs = Math.floor(appUptime / 3600);
                const mins = Math.floor((appUptime % 3600) / 60);
                const uptimeStr = `${hrs}h ${mins}m`;
                
                const memUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
                const mongoStatus = mongoose.connection.readyState === 1 ? "🟢 Connected" : "🔴 Offline";
                
                let lockStatus = "Unlocked";
                try {
                    const lock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
                    if (lock && lock.status === "Running") lockStatus = `Locked by ${lock.runner}`;
                } catch (e) {}

                const lastPipelineStart = pipelineState.lastRunTime ? new Date(pipelineState.lastRunTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " IST" : "Never";
                const lastTelegramMsg = listenerStatus.lastJobMessageAt ? new Date(listenerStatus.lastJobMessageAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) + " IST" : "Never";
                
                const procTime = new Date() - receivedTime;
                
                const replyMessage = `✅ RoleNova Diagnostics\n\nEnvironment\n${process.env.NODE_ENV === "production" ? "Production" : "Development"}\n\nVersion\nv1.0.0 (${gitCommit})\n\nStatus\nHealthy\n\nTelegram\n🟢 Connected\n\nMongoDB\n${mongoStatus}\n\nPipeline\n${pipelineState.status === "Running" ? "🔵 Running" : "🟢 Idle"}\n\nDistributed Lock\n${lockStatus}\n\nGemini\n${pipelineState.geminiStatus === "Ready" ? "🟢 Ready" : "🔴 " + pipelineState.geminiStatus}\n${pipelineState.geminiReason ? "Reason:\n" + pipelineState.geminiReason : ""}\n\nGroq\n${pipelineState.groqStatus === "Ready" ? "🟢 Ready" : "🔴 " + pipelineState.groqStatus}\n\nZ.ai\n${pipelineState.zaiStatus === "Ready" ? "🟢 Ready" : "🔴 " + pipelineState.zaiStatus}\n\nLocal\n${pipelineState.localStatus === "Ready" ? "🟢 Ready" : "🔴 " + pipelineState.localStatus}\n\nLast Pipeline\n${lastPipelineStart}\n\nLast Telegram Message\n${lastTelegramMsg}\n\nMemory\n${memUsage} MB\n\nUptime\n${uptimeStr}\n\nLatency\n${procTime} ms`;
                
                try {
                    await telegramClient.sendMessage(message.peerId, { message: replyMessage, replyTo: message.id });
                } catch (e) {
                    console.log(`[Telegram] Failed to reply: ${e.message}`);
                }

                console.log(`[Telegram] Health Diagnostics sent in ${procTime}ms`);
            } else {
                console.log(`[Telegram] Unauthorized Diagnostics Attempt from User ID: ${senderIdStr}`);
                console.log("RETURN REASON: - Unauthorized health command");
                return;
            }
            console.log("RETURN REASON: - Health command handled");
            return; // Skip remaining pipeline regardless of authorization
        }

        let chat = null;
        try {
            chat = await message.getChat();
            chatUsername = chat?.username || "";
            console.log("Chat ID: " + (chat?.id ? chat.id.toString() : "Undefined"));
            console.log("Chat Title: " + (chat?.title || "Undefined"));
            console.log("Chat Username: " + (chat?.username || "Undefined"));
            console.log("Chat Class: " + (chat?.className || "Undefined"));
            console.log("Broadcast: " + (chat?.broadcast ? "true" : "false"));
            console.log("Megagroup: " + (chat?.megagroup ? "true" : "false"));
            console.log("Verified: " + (chat?.verified ? "true" : "false"));
        } catch (e) {
            console.log(`[Telegram] Failed to get chat for message: ${e.message}`);
        }
        
        console.log("Allowed\n[\n" + Array.from(allowedChannels).join(",\n") + "\n]");
        console.log("Incoming Username\n" + (chatUsername || ""));
        const testMode = process.env.TELEGRAM_TEST_MODE === "true";
        const rawTestChannel = process.env.TELEGRAM_TEST_CHANNEL || "";
        const testChannelEnv = rawTestChannel.trim().replace(/^@/, "").toLowerCase();
        const incomingNorm = chatUsername ? chatUsername.trim().toLowerCase() : "";
        
        let isAllowed = false;
        
        if (testMode) {
            isAllowed = chatUsername && incomingNorm === testChannelEnv;
            if (!isAllowed) {
                console.log("Expected Channel:\n" + rawTestChannel);
                console.log("Incoming Channel:\n" + (chatUsername || ""));
                console.log("Normalized Expected:\n" + testChannelEnv);
                console.log("Normalized Incoming:\n" + incomingNorm);
                console.log("Decision:\nREJECTED");
                console.log("Reason:\nTest channel mismatch or missing username");
                return;
            }
        } else {
            isAllowed = chatUsername && allowedChannels.has(incomingNorm);
            console.log("Result\n" + isAllowed.toString().toUpperCase());

            if (!chatUsername) {
                console.log("RETURN REASON: - Channel Username Missing");
                return;
            }

            if (!isAllowed) {
                console.log("RETURN REASON: - Production channel mismatch");
                return;
            }
        }
        
        if (testMode) {
            logWithTime(`[INFO] Telegram Message Received | Channel: <${chatUsername || 'Unknown'}> | MsgID: ${message.id}`);
        } else {
            logWithTime(`[INFO] Telegram Message Received | Channel: <${chatUsername || 'Unknown'}> | MsgID: ${message.id}`);
        }
        
        await processMessageContent(text, message.entities || [], chatUsername, message.id);

    } catch (handlerError) {
        console.log(`[Telegram] Unhandled Error in message handler: ${handlerError.message}`);
        TelegramChannel.findOneAndUpdate(
            { username: { $regex: new RegExp(`^${chatUsername || ''}$`, 'i') } },
            { $inc: { errorCount: 1 }, $set: { lastError: handlerError.message, status: "Error" } }
        ).catch(() => {});
        emitTelegramSnapshot({
            channel: chatUsername || "Unknown",
            text: handlerError.message,
            receivedAt: new Date(),
            error: true
        }).catch(() => {});
    }
};

/**
 * Shared message processing core.
 * Called by both the live NewMessage handler and the historical backfill service.
 * @param {string}   text          - Raw message text
 * @param {Array}    entities      - GramJS entity array (for hidden URLs)
 * @param {string}   chatUsername  - Channel username (already validated as allowed)
 * @param {number}   messageId     - Telegram message ID
 * @param {object}   [opts]        - Optional overrides
 * @param {boolean}  [opts.silent] - If true, suppress stage banners (for backfill batch mode)
 */
const processMessageContent = async (text, entities, chatUsername, messageId, opts = {}) => {
    const silent = opts.silent || false;
    try {
        const channelRecord = await TelegramChannel.findOneAndUpdate(
            { username: { $regex: new RegExp(`^${chatUsername}$`, 'i') } },
            {
                $inc: { messagesProcessed: 1 },
                $set: { lastActivity: new Date(), lastMessageAt: new Date(), lastProcessedAt: new Date(), status: "Online" }
            },
            { returnDocument: "after" }
        ).catch(() => null);

        emitTelegramSnapshot({
            channel: chatUsername || "Unknown",
            text: (text || "").substring(0, 240),
            receivedAt: new Date(),
            parsed: false,
            matched: false
        }).catch(() => {});

        // Extract hidden URLs from entities
        let inlineUrls = [];
        if (entities && entities.length > 0) {
            entities.forEach(entity => {
                if (entity.className === 'MessageEntityTextUrl' && entity.url) {
                    inlineUrls.push(entity.url);
                }
            });
        }

        logWithTime(`[INFO] Parsing Message... (Extracted ${inlineUrls.length} hidden entities)`);

        if (!isJobMessage(text, inlineUrls)) {
            if (channelRecord) {
                channelRecord.ignoredMessages = (channelRecord.ignoredMessages || 0) + 1;
                await channelRecord.save();
            }
            logWithTime(`[WARNING] Not a Job Message (skipped)`);
            return { jobCount: 0, matchCount: 0, processedJobs: [] };
        }

        listenerStatus.lastJobMessageAt = new Date();

        if (!silent) {
            console.log("\n├─ STAGE 2: Structured Parser");
        }
        const structuredData = parseStructuredPost(text);
        let urls = extractUrls(text);
        urls.push(...inlineUrls);
        urls = [...new Set(urls)];

        if (!silent) {
            console.log(`│  company    : ${structuredData.company || "(not found)"}`);
            console.log(`│  role       : ${structuredData.role || "(not found)"}`);
            console.log(`│  location   : ${structuredData.location || "(not found)"}`);
            console.log(`│  experience : ${structuredData.experience || "(not found)"}`);
            console.log(`│  URLs found : ${urls.length}`);
            urls.forEach((u, i) => console.log(`│    [${i+1}] ${u}`));
        }

        if (urls.length === 0) {
            if (!silent) console.log("└─ STAGE 2 RESULT: No URLs found — cannot process");
            return { jobCount: 0, matchCount: 0, processedJobs: [] };
        }
        if (!silent) console.log("└─ STAGE 2 RESULT: OK");

        const companyName = structuredData.company || "External Job";
        let telegramCompany = await Company.findOne({ name: companyName });
        if (!telegramCompany) {
            telegramCompany = await Company.create({
                name: companyName,
                careerUrl: "https://t.me",
                ats: "telegram",
                category: "Telegram",
                active: false
            });
            logWithTime(`[INFO] Dynamic company created: ${companyName}`);
        }

        const profile = await getActiveProfile();

        let jobCount = 0;
        let matchCount = 0;
        let processedJobs = [];

        for (const url of urls) {
            const result = await processJobUrl(url, telegramCompany, profile, structuredData, chatUsername, messageId);
            if (result && result.parsed) {
                jobCount++;
                processedJobs.push({
                    company: result.job?.inferredCompany || result.job?.companyName || telegramCompany.name,
                    role: result.job?.title || "Unknown Role",
                    location: result.job?.location || "Unknown Location",
                    source: chatUsername,
                    applyLink: url,
                    score: result.result?.score || 0,
                    status: result.matched ? "AI Accepted" : (result.result ? "AI Rejected" : "Parsed")
                });
            }
            if (result && result.matched) matchCount++;
        }

        if (channelRecord) {
            if (jobCount > 0) channelRecord.jobsFound = (channelRecord.jobsFound || 0) + jobCount;
            if (matchCount > 0) channelRecord.matchedJobs = (channelRecord.matchedJobs || 0) + matchCount;
            if (jobCount === 0) channelRecord.parsingFailures = (channelRecord.parsingFailures || 0) + 1;
            await channelRecord.save();
        }

        const socketPayload = {
            channel: chatUsername || "Unknown",
            text: (text || "").substring(0, 240),
            receivedAt: new Date(),
            messageId,
            parsed: jobCount > 0,
            matched: matchCount > 0,
            jobsFound: jobCount,
            matchedJobs: matchCount,
            processedJobs
        };

        if (!silent) {
            console.log("\n╔══════════════════════════════════════════════════╗");
            console.log("║   STAGE 7: Socket.IO Emission                    ║");
            console.log("╚══════════════════════════════════════════════════╝");
            console.log(`  Event         : telegram:update`);
            console.log(`  channel       : ${socketPayload.channel}`);
            console.log(`  jobsFound     : ${socketPayload.jobsFound}`);
            console.log(`  matchedJobs   : ${socketPayload.matchedJobs}`);
            console.log(`  processedJobs : ${socketPayload.processedJobs.length} job(s)`);
            socketPayload.processedJobs.forEach((j, i) => {
                console.log(`    [${i+1}] ${j.role} @ ${j.company} | score=${j.score} | ${j.status}`);
            });
        }

        emitTelegramSnapshot(socketPayload).catch(() => {});

        if (!silent) {
            console.log("\n╔══════════════════════════════════════════════════╗");
            console.log("║   STAGE 9: Pipeline Complete — Log Summary       ║");
            console.log("╚══════════════════════════════════════════════════╝");
            console.log(`  ✅ Message ID                : ${messageId}`);
            console.log(`  ✅ Channel                  : ${chatUsername}`);
            console.log(`  ✅ Job Parsed               : ${jobCount > 0 ? "YES (" + jobCount + " job(s))" : "NO"}`);
            console.log(`  ✅ AI Evaluation            : ${matchCount > 0 ? "MATCHED" : (jobCount > 0 ? "REJECTED/SKIPPED" : "NOT REACHED")}`);
            console.log(`  ✅ Storage                  : ${jobCount > 0 ? "WRITTEN" : "NOT WRITTEN"}`);
            console.log(`  ✅ Socket Broadcast         : telegram:update emitted`);
        }

        return { jobCount, matchCount, processedJobs };

    } catch (err) {
        console.log(`[Telegram] processMessageContent error (msgId=${messageId}): ${err.message}`);
        return { jobCount: 0, matchCount: 0, processedJobs: [], error: err.message };
    }
};

const handleDisconnect = () => {
    if (isReconnecting) return;
    isReconnecting = true;
    
    listenerStatus.status = "Disconnected";
    listenerStatus.lastDisconnectedAt = new Date();
    console.log(`[Telegram] Disconnected`);
    
    if (global.telegramReconnectTimer) {
        clearTimeout(global.telegramReconnectTimer);
    }
    
    console.log(`[Telegram] Reconnect Scheduled in ${reconnectDelay}ms`);
    global.telegramReconnectTimer = setTimeout(() => {
        startTelegramListener();
        reconnectDelay = Math.min(reconnectDelay * 2, 60000); 
    }, reconnectDelay);
};

const startTelegramListener = async () => {
    if (isStarting) return;
    isStarting = true;

    if (!API_ID || !API_HASH) {
        console.log("[Telegram] Credentials missing — listener not started");
        listenerStatus.status = "Error";
        isStarting = false;
        return;
    }
    
    console.log("[Telegram] Starting");
    listenerStatus.status = "Connecting";
    
    if (global.telegramReconnectTimer) {
        clearTimeout(global.telegramReconnectTimer);
        global.telegramReconnectTimer = null;
    }

    try {
        if (telegramClient) {
            console.log("[Telegram] Cleaning up old client instance");
            try { await telegramClient.disconnect(); } catch (e) {}
            try { await telegramClient.destroy(); } catch (e) {}
            telegramClient = null;
        }

        const session = new StringSession(process.env.TELEGRAM_SESSION || "");
        telegramClient = new TelegramClient(session, API_ID, API_HASH, {
            connectionRetries: 5,
        });

        await telegramClient.connect();
        
        // Re-authenticate silently if necessary but connect() handles this automatically with valid session.
        // GramJS will throw if session is completely dead/empty.

        listenerStatus.status = "Connected";
        listenerStatus.lastConnectedAt = new Date();
        listenerStatus.uptimeStart = new Date();
        listenerStatus.layer = telegramClient.session.serverAddress || "Unknown"; 
        listenerStatus.dc = telegramClient.session.dcId || "Unknown";
        
        // Reset state
        reconnectDelay = 5000;
        isReconnecting = false;
        
        await loadChannels();

        console.log("[Telegram] Connected");

        // ── Historical Backfill (once per startup, non-blocking) ─────────────
        const { runBackfill } = require("./telegramBackfillService");
        runBackfill(telegramClient).catch(err => {
            console.log(`[Telegram Sync] Backfill error: ${err.message}`);
        });
        
        // Bind cleanly
        const filter = new NewMessage({});
        telegramClient.addEventHandler(handleIncomingMessage, filter);
        console.log("TelegramClient initialized");
        console.log("Client connected");
        console.log("Event handler registered");
        console.log("NewMessage filter");
        console.log(`{ _noCheck: ${filter._noCheck}, chats: ${filter.chats} }`);
        console.log("Number of handlers registered");
        console.log(telegramClient._eventBuilders.length);
        console.log("[Telegram] Listener Registered");
        
        const testMode = process.env.TELEGRAM_TEST_MODE === "true";
        const rawTestChannel = process.env.TELEGRAM_TEST_CHANNEL || "None";
        const normalizedTestChannel = rawTestChannel.trim().replace(/^@/, "").toLowerCase();
        
        console.log("========================================");
        console.log("Telegram Configuration");
        console.log("========================================");
        console.log("Mode:\n" + (testMode ? "Test" : "Production"));
        console.log("Test Mode:\n" + (testMode ? "Enabled" : "Disabled"));
        console.log("Configured Test Channel:\n<" + rawTestChannel + ">");
        console.log("Normalized Test Channel:\n<" + normalizedTestChannel + ">");
        console.log("Listener Registered:\nYES");
        console.log("Environment:\n" + (process.env.NODE_ENV === "production" ? "Production" : "Development"));
        console.log("========================================");
        
        isStarting = false;

    } catch (error) {
        isStarting = false;
        isReconnecting = false; // Reset to allow handleDisconnect to run
        if (error.message && error.message.includes('AUTH_KEY_DUPLICATED')) {
            console.log(`[Telegram] AUTH_KEY_DUPLICATED. The session string is invalidated.`);
            listenerStatus.status = "Error: Invalid Session";
            return;
        }
        console.log(`[Telegram] Reconnect Failed: ${error.message}`);
        handleDisconnect();
    }
};


const getListenerStatus = () => listenerStatus;

const reloadChannels = async () => {
    await loadChannels();
    return allowedChannels.size;
};

const reconnectTelegram = async () => {
    await startTelegramListener();
    return listenerStatus;
};

const stopTelegramListener = () => {
    if (telegramClient) {
        console.log('[Telegram] Disconnecting client...');
        telegramClient.disconnect();
        listenerStatus.status = "Disconnected (Manual)";
    }
};

const getTelegramClient = () => telegramClient;

module.exports = {
    startTelegramListener,
    stopTelegramListener,
    parseStructuredPost,
    processJobUrl,
    processMessageContent,
    isJobMessage,
    getListenerStatus,
    reloadChannels,
    reconnectTelegram,
    handleIncomingMessage,
    getTelegramClient,
};
