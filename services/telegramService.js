const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
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

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;


const logWithTime = (msg) => {
    const time = new Date().toTimeString().split(" ")[0];
    console.log(`[${time}] ${msg}`);
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

const startTelegramListener = async () => {
    if (!API_ID || !API_HASH) {
        logWithTime("Telegram credentials missing — listener not started");
        return;
    }

    try {
        const session = new StringSession(process.env.TELEGRAM_SESSION || "");
        const client = new TelegramClient(session, API_ID, API_HASH, {
            connectionRetries: 5,
        });

        await client.start({
            phoneNumber: async () => await input.text("Enter your Telegram phone number: "),
            password: async () => await input.text("Enter your 2FA password (if any): "),
            phoneCode: async () => await input.text("Enter the OTP you received: "),
            onError: (err) => logWithTime(`Telegram auth error: ${err.message}`),
        });

        const sessionString = client.session.save();
        if (sessionString && !process.env.TELEGRAM_SESSION) {
            console.log("=================================");
            console.log("SAVE THIS SESSION STRING IN .env:");
            console.log(sessionString);
            console.log("=================================");
        }

        logWithTime("Connected to Telegram");
        
        
        let allowedChannels = new Set();
        
        const loadChannels = async () => {
            const channels = await TelegramChannel.find({ enabled: true });
            allowedChannels = new Set(channels.map(c => c.username.toLowerCase()));
            if(allowedChannels.size > 0) {
                logWithTime(`Listening to ${allowedChannels.size} channels`);
            } else {
                logWithTime("No enabled channels found in registry.");
            }
        };

        
        await loadChannels();
        
        
        setInterval(loadChannels, 60000);

        client.addEventHandler(async (event) => {
            try {
                const message = event.message;
                if (!message?.message) return;

                const chatUsername = event._chat?.username || "";
                
                
                if (!chatUsername || !allowedChannels.has(chatUsername.toLowerCase())) return;

                const text = message.message;
                
                
                await TelegramChannel.findOneAndUpdate(
                    { username: { $regex: new RegExp(`^${chatUsername}$`, 'i') } },
                    { 
                        $inc: { messagesProcessed: 1 },
                        $set: { lastActivity: new Date() }
                    }
                ).catch(() => {});

                let inlineUrls = [];
                
                if (message.entities) {
                    message.entities.forEach(entity => {
                        if (entity.className === 'MessageEntityTextUrl') {
                            inlineUrls.push(entity.url);
                        }
                    });
                }

                if (!isJobMessage(text, inlineUrls)) {
                    return; 
                }

                logWithTime(`New message received - Channel: ${chatUsername}`);

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

                for (const url of urls) {
                    await processJobUrl(url, telegramCompany, profile, structuredData, chatUsername, telegramMessageId);
                }

            } catch (handlerError) {
                logWithTime(`Telegram handler error: ${handlerError.message}`);
            }
        });

        client.addEventHandler((event) => {
            logWithTime(`Connection state changed... attempting recovery if needed.`);
        });

    } catch (error) {
        logWithTime(`Telegram listener failed to start: ${error.message}`);
    }
};

module.exports = { startTelegramListener, parseStructuredPost, processJobUrl, isJobMessage };