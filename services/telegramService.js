const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const axios = require("axios");

const Company = require("../models/Company");
const CandidateProfile = require("../models/CandidateProfile");

const { extractUrls, getUrlStrategy } = require("../utils/urlStrategy");
const {
    saveRawJob,
    analyseWithGemini,
    getActiveProfile,
} = require("../cron/jobSearchCron");
const { saveMatchedJob } = require("../cron/jobSearchCron");
const { sendMatchedJobEmail } = require("./emailService");

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const GROUP_USERNAME = process.env.TELEGRAM_GROUP_USERNAME || "LMTJobUpdates";

// Message me job posting ke signals hone chahiye
// Warna YouTube/course ads bhi process ho jayenge
const isJobMessage = (text = "") => {
    const lower = text.toLowerCase();
    return (
        /\b(company|role|apply|hiring|intern|internship|fresher|sde|developer|engineer|opening|job|position)\b/i.test(lower)
    );
};

// Telegram channel ke structured posts se company/role directly parse karta hai
// Example: "Company: Bright Money\nRole: SDE Intern\nApply at: https://..."
const parseStructuredPost = (text = "") => {
    const companyMatch = text.match(/company[:\s]+([^\n]+)/i);
    const roleMatch = text.match(/role[:\s]+([^\n]+)/i);

    return {
        company: companyMatch?.[1]?.trim() || null,
        role: roleMatch?.[1]?.trim() || null,
    };
};

// Job URL se title aur basic info scrape karta hai
// Ye sirf un URLs ke liye hai jo greenhouse/lever/workday nahi hain
const scrapeGenericJobPage = async (url) => {
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
            },
            timeout: 15000,
        });

        const html = response.data || "";

        // Title tag se job title nikalo
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch?.[1]
            ?.replace(/\s*[\|\-–]\s*.*/g, "")
            ?.trim() || "Job Opening";

        // Meta description se location guess karo
        const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
        const metaText = metaMatch?.[1] || "";

        const locationMatch = metaText.match(/\b(india|bangalore|bengaluru|noida|hyderabad|pune|remote|mumbai|chennai|gurugram)\b/i);
        const location = locationMatch?.[0] || "India";

        // First 800 chars of visible text as description
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
            applyLink: url,
            jobId: url.split("/").filter(Boolean).pop(),
            employmentType: /intern/i.test(title) ? "Internship" : "Full-Time",
        };

    } catch (error) {
        console.log(`Generic scrape failed for ${url}: ${error.message}`);
        return null;
    }
};

// Ek URL ko process karta hai — scrape, pre-filter, Gemini, save
const processJobUrl = async (url, telegramCompany, profile, structuredData) => {
    try {
        const strategy = getUrlStrategy(url);

        if (!strategy) {
            console.log(`Skipped non-job URL: ${url}`);
            return;
        }

        console.log(`Processing Telegram URL [${strategy}]: ${url}`);

        let job = null;

        if (strategy === "generic-html") {
            job = await scrapeGenericJobPage(url);
        } else {
            // greenhouse/lever/workday — inke liye direct URL se scraping mushkil hai
            // structured post data use karo agar available hai
            job = {
                title: structuredData.role || "Job Opening",
                location: "India",
                description: structuredData.role || "Software Engineer role",
                applyLink: url,
                jobId: url.split("/").filter(Boolean).pop(),
                employmentType: /intern/i.test(structuredData.role || "") ? "Internship" : "Full-Time",
            };
        }

        if (!job) {
            console.log(`Could not extract job from: ${url}`);
            return;
        }

        // Override title/company from structured post if available
        if (structuredData.role) job.title = structuredData.role;
        if (structuredData.company) job.description = `${structuredData.company} - ${job.description}`;

        const rawJob = await saveRawJob(telegramCompany, job);
        console.log(`Telegram Job Saved: ${job.title}`);

        if (rawJob.aiMatched) {
            console.log(`Already matched: ${job.title}`);
            return;
        }

        const aiState = { calls: 0, quotaExceeded: false };
        const result = await analyseWithGemini(job, profile, aiState);

        if (result.skipped) {
            console.log(`Skipped Gemini for ${job.title}: ${result.reason}`);
            return;
        }

        const matched = await saveMatchedJob(rawJob, telegramCompany, job, result.analysis);

        if (matched) {
            console.log(`Telegram Matched Job: ${job.title} | Score: ${result.analysis.score}`);
            try {
                await sendMatchedJobEmail({
                    company: telegramCompany,
                    job,
                    analysis: result.analysis,
                });
            } catch (emailError) {
                console.log(`Email failed: ${emailError.message}`);
            }
        }

    } catch (error) {
        console.log(`Error processing URL ${url}: ${error.message}`);
    }
};

// Telegram client start karta hai aur group messages sunta hai
const startTelegramListener = async () => {
    if (!API_ID || !API_HASH) {
        console.log("Telegram credentials missing — listener not started");
        return;
    }

    try {
        const session = new StringSession(process.env.TELEGRAM_SESSION || "");

        const client = new TelegramClient(session, API_ID, API_HASH, {
            connectionRetries: 5,
        });

        // Pehli baar session empty hoga to login prompt aayega
        await client.start({
            phoneNumber: async () => await input.text("Enter your Telegram phone number: "),
            password: async () => await input.text("Enter your 2FA password (if any): "),
            phoneCode: async () => await input.text("Enter the OTP you received: "),
            onError: (err) => console.log("Telegram auth error:", err),
        });

        // Session string save karo — .env me TELEGRAM_SESSION me paste karna hoga
        const sessionString = client.session.save();
        if (sessionString && !process.env.TELEGRAM_SESSION) {
            console.log("=================================");
            console.log("SAVE THIS SESSION STRING IN .env:");
            console.log(sessionString);
            console.log("=================================");
        }

        console.log("Telegram listener started — watching:", GROUP_USERNAME);

        // Har naye message par ye handler fire hoga
        client.addEventHandler(async (event) => {
            try {
                const message = event.message;
                if (!message?.message) return;

                const text = message.message;
                const chatUsername = event._chat?.username || "";

                // Sirf target group ke messages process karo
                if (chatUsername.toLowerCase() !== GROUP_USERNAME.toLowerCase()) return;

                // Job signal nahi hai to skip
                if (!isJobMessage(text)) {
                    console.log("Skipped non-job Telegram message");
                    return;
                }

                console.log("Job message detected in Telegram group");

                // Structured data parse karo (Company/Role lines)
                const structuredData = parseStructuredPost(text);

                // URLs extract karo
                const urls = extractUrls(text);
                if (urls.length === 0) return;

                // Telegram placeholder company fetch karo
                const telegramCompany = await Company.findOne({ name: "Telegram Jobs" });
                if (!telegramCompany) {
                    console.log("Telegram Jobs company not found in DB — run seed first");
                    return;
                }

                // Active profile fetch karo
                const profile = await getActiveProfile();

                // Har URL ko process karo
                for (const url of urls) {
                    await processJobUrl(url, telegramCompany, profile, structuredData);
                }

            } catch (handlerError) {
                console.log("Telegram handler error:", handlerError.message);
            }
        });

    } catch (error) {
        console.log("Telegram listener failed to start:", error.message);
    }
};

module.exports = { startTelegramListener };