const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { normalizeJobUrl } = require("../utils/urlNormalizer");

const Company = require("../models/Company");
const CandidateProfile = require("../models/CandidateProfile");
const TelegramChannel = require("../models/TelegramChannel");

const { extractUrls, getUrlStrategy } = require("../utils/urlStrategy");
const {
    saveRawJob,
    analyseWithGemini,
    getActiveProfile,
    saveMatchedJob
} = require("../cron/jobSearchCron");
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

const listenerStatus = {
    status: "Disconnected",
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    uptimeStart: null,
    layer: "Unknown",
    dc: "Unknown",
    version: "2.26.15", // Typical GramJS version
    lastHealthCheckAt: null,
    lastJobMessageAt: null,
    lastDiagnosticsUser: null
};

let telegramClient = null;
let reconnectDelay = 5000;
let isReconnecting = false;
let allowedChannels = new Set();

const loadChannels = async () => {
    const channels = await TelegramChannel.find({ enabled: true });
    allowedChannels = new Set(channels.map(c => c.username.toLowerCase()));
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
    try {
        const strategy = getUrlStrategy(url);

        if (!strategy) {
            logWithTime(`Skipped non-job URL: ${url}`);
            return;
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
            logWithTime(`Scraper returned null for URL: ${url}. Skipping.`);
            return;
        }

        
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
            } catch (e) {
                
            }
        }

        if (!job) {
            logWithTime(`Could not extract job from: ${url}`);
            return;
        }

        if (structuredData.role) job.title = structuredData.role;
        if (structuredData.company) job.description = `${structuredData.company} - ${job.description}`;
        
        job.sourceChannel = sourceChannel;
        job.telegramMessageId = telegramMessageId;
        job.sourceName = sourceChannel;

        const rawJob = await saveRawJob(telegramCompany, job);
        logWithTime(`Job Parsed Successfully: ${job.title}`);

        if (rawJob.aiMatched) {
            logWithTime(`Already matched: ${job.title}`);
            return;
        }

        const aiState = { calls: 0, quotaExceeded: false };
        const result = await analyseWithGemini(job, profile, aiState);

        if (result.skipped) {
            logWithTime(`Skipped Gemini for ${job.title}: ${result.reason}`);
            return;
        }
        
        logWithTime(`Gemini Score: ${result.analysis.score}`);
        
        if (result.analysis) {
            saveTrainingSample(job, telegramCompany, result.analysis, "TelegramListener", "Telegram").catch(err => {
                logWithTime(`[TrainingDataset] Async save error: ${err.message}`);
            });
        }

        const matched = await saveMatchedJob(rawJob, telegramCompany, job, result.analysis);

        if (matched) {
            logWithTime(`Matched Job: ${job.title} | Email Sent`);
            try {
                await sendMatchedJobEmail({
                    company: telegramCompany,
                    job,
                    analysis: result.analysis,
                });
            } catch (emailError) {
                logWithTime(`Email failed: ${emailError.message}`);
            }
        }

    } catch (error) {
        logWithTime(`Error processing URL ${url}: ${error.message}`);
    }
};

const handleIncomingMessage = async (event) => {
    try {
        const message = event.message;
        if (!message?.message) return;

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
            }
            return; // Skip remaining pipeline regardless of authorization
        }

        const chatUsername = event._chat?.username || "";
        
        if (!chatUsername || !allowedChannels.has(chatUsername.toLowerCase())) {
            return;
        }
        
        console.log(`[Telegram] Channel Message from @${chatUsername}`);
        
        const channelRecord = await TelegramChannel.findOneAndUpdate(
            { username: { $regex: new RegExp(`^${chatUsername}$`, 'i') } },
            { 
                $inc: { messagesProcessed: 1 },
                $set: { lastActivity: new Date(), lastMessageAt: new Date(), lastProcessedAt: new Date(), status: "Online" }
            },
            { returnDocument: "after" }
        ).catch(() => null);

        let inlineUrls = [];
        if (message.entities) {
            message.entities.forEach(entity => {
                if (entity.className === 'MessageEntityTextUrl') {
                    inlineUrls.push(entity.url);
                }
            });
        }

        if (!isJobMessage(text, inlineUrls)) {
            if (channelRecord) {
                channelRecord.ignoredMessages += 1;
                await channelRecord.save();
            }
            return; 
        }

        listenerStatus.lastJobMessageAt = new Date();

        console.log("[Telegram] Message Received");
        console.log(`[Telegram] Channel: @${chatUsername} | Message Id: ${message.id}`);

        const structuredData = parseStructuredPost(text);
        let urls = extractUrls(text);
        urls.push(...inlineUrls);
        urls = [...new Set(urls)];
        
        if (urls.length === 0) return;

        const telegramCompany = await Company.findOne({ name: "Telegram Jobs" });
        if (!telegramCompany) {
            logWithTime("Telegram Jobs company not found in DB — run seed first");
            return;
        }

        const profile = await getActiveProfile();
        const telegramMessageId = message.id;

        let jobCount = 0;
        let matchCount = 0;
        for (const url of urls) {
            const result = await processJobUrlWrapper(url, telegramCompany, profile, structuredData, chatUsername, telegramMessageId);
            if (result && result.parsed) jobCount++;
            if (result && result.matched) matchCount++;
        }
        
        if (channelRecord) {
            if (jobCount > 0) channelRecord.jobsFound += jobCount;
            if (matchCount > 0) channelRecord.matchedJobs += matchCount;
            if (jobCount === 0) channelRecord.parsingFailures += 1;
            await channelRecord.save();
        }

    } catch (handlerError) {
        console.log(`[Telegram] Unhandled Error in message handler: ${handlerError.message}`);
        TelegramChannel.findOneAndUpdate(
            { username: { $regex: new RegExp(`^${event._chat?.username || ''}$`, 'i') } },
            { $inc: { errorCount: 1 }, $set: { lastError: handlerError.message, status: "Error" } }
        ).catch(() => {});
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
    if (!API_ID || !API_HASH) {
        console.log("[Telegram] Credentials missing — listener not started");
        listenerStatus.status = "Error";
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
        
        // Polling channels
        if (global.telegramChannelPoller) clearInterval(global.telegramChannelPoller);
        global.telegramChannelPoller = setInterval(loadChannels, 60000);

        // Bind cleanly
        telegramClient.addEventHandler(handleIncomingMessage, new NewMessage({}));
        console.log("[Telegram] Listener Registered");
        


    } catch (error) {
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

const processJobUrlWrapper = async (url, telegramCompany, profile, structuredData, chatUsername, telegramMessageId) => {
    let parsed = false;
    let matched = false;
    try {
        const _logWithTime = console.log;
        console.log = function() {}; // Mute inner logs to respect formatting requested
        
        let applyLink;
        try { applyLink = normalizeJobUrl(new URL(url).toString()); }
        catch { applyLink = normalizeJobUrl(url.trim()); }
        
        const jobId = applyLink.split("/").filter(Boolean).pop();
        
        const job = {
            title: structuredData.role || "Job Opening",
            location: structuredData.location || "India",
            description: structuredData.role || "Software Engineer role",
            experience: structuredData.experience || null,
            salary: structuredData.salary || null,
            applyLink,
            jobId,
            employmentType: /intern/i.test(structuredData.role || structuredData.type || "") ? "Internship" : "Full-Time",
            sourceChannel: chatUsername,
            telegramMessageId,
            sourceName: chatUsername
        };
        
        const rawJob = await saveRawJob(telegramCompany, job);
        parsed = true;
        
        if (!rawJob.aiMatched) {
            const aiState = { calls: 0, quotaExceeded: false };
            const aiResult = await analyseWithGemini(job, profile, aiState);
            if (!aiResult.skipped) {
                if (aiResult.analysis) {
                    saveTrainingSample(job, telegramCompany, aiResult.analysis, "TelegramListener", "Telegram").catch(err => {
                        _logWithTime(`[TrainingDataset] Async save error: ${err.message}`);
                    });
                }
                const matchedJobResult = await saveMatchedJob(rawJob, telegramCompany, job, aiResult.analysis);
                if (matchedJobResult) matched = true;
            }
        }
        console.log = _logWithTime;
        return { parsed, matched };
    } catch (e) {
        return { parsed, matched };
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

module.exports = { startTelegramListener, parseStructuredPost, processJobUrl, isJobMessage, getListenerStatus, reloadChannels, reconnectTelegram };
