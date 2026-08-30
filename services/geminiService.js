const { OpenAI } = require("openai");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { classifyDomain } = require("../utils/domains");
const { buildEvaluationPrompt, parseJsonResponse, analyzeError, validateAiResponse } = require("./aiHelpers");
const { withLogContext } = require("../utils/logger");
const RedisCacheService = require("./redis/redisCacheService");

// Initialize Gemini Client
let geminiClient = null;
if (process.env.GEMINI_API_KEY) {
    try {
        geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    } catch (e) {
        console.error("[AI Init] Failed to initialize Google Generative AI client:", e.message);
    }
}

// Groq Key Pool configuration
const getGroqKeys = () => {
    const keys = [];
    if (process.env.GROQ_API_KEYS) {
        process.env.GROQ_API_KEYS.split(',').forEach(k => {
            const trimmed = k.trim();
            if (trimmed) keys.push(trimmed);
        });
    }
    ['GROQ_API_KEY_1', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4', 'GROQ_API_KEY'].forEach(envName => {
        if (process.env[envName] && !keys.includes(process.env[envName].trim())) {
            keys.push(process.env[envName].trim());
        }
    });
    return keys;
};

let groqKeyIndex = 0;
const exhaustedGroqKeys = new Set();

const getNextGroqClient = () => {
    const keys = getGroqKeys();
    if (keys.length === 0) return null;
    
    // Find next non-exhausted key
    for (let i = 0; i < keys.length; i++) {
        const idx = (groqKeyIndex + i) % keys.length;
        const key = keys[idx];
        if (!exhaustedGroqKeys.has(key)) {
            groqKeyIndex = (idx + 1) % keys.length;
            return {
                client: new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" }),
                keyIndex: idx + 1,
                apiKey: key
            };
        }
    }
    return null;
};

const getText = (job) =>
    [job.title, job.location, job.experience, job.description, job.employmentType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

// Deterministic Local Heuristic Evaluator
const evaluateJobLocally = (job, profile, reasonPrefix = "AI unavailable") => {
    const text = getText(job);
    let score = 50;
    const missingSkills = [];
    const matchedSkills = [];
    const reasonsFor = [];
    const reasonsAgainst = [];
    
    let domainMismatch = false;
    let experienceMismatch = false;

    const profileSkills = (profile.skills || []).map(s => s.toLowerCase());
    const commonTechs = ["node.js", "express", "mongodb", "react", "python", "java", "aws", "kubernetes", "docker", "sql", "linux", "rest api", "javascript", "c++", "dsa"];
    const requiredSkills = commonTechs.filter(tech => text.includes(tech));
    
    let skillMatches = 0;
    for (const reqSkill of requiredSkills) {
        const found = profileSkills.some(ps => ps.includes(reqSkill) || reqSkill.includes(ps));
        if (found) {
            skillMatches++;
            matchedSkills.push(reqSkill);
        } else {
            missingSkills.push(reqSkill);
        }
    }
    
    const skillOverlapPercentage = requiredSkills.length > 0 ? Math.round((skillMatches / requiredSkills.length) * 100) : 80;
    
    if (skillOverlapPercentage < 40 && requiredSkills.length > 0) {
        score -= 15;
        reasonsAgainst.push(`Low skill overlap (${skillOverlapPercentage}%). Missing: ${missingSkills.join(", ")}`);
    } else if (skillMatches > 0) {
        score += 25;
        reasonsFor.push(`Strong skill match (${skillOverlapPercentage}% overlap)`);
    }

    const jobDomain = classifyDomain(text);
    const excludedDomains = (profile.excludedDomains || []).map(d => d.toUpperCase());
    
    if (excludedDomains.includes(jobDomain)) {
        domainMismatch = true;
        score -= 50;
        reasonsAgainst.push(`Domain mismatch: Role classified as ${jobDomain}, which is excluded by candidate.`);
    } else {
        reasonsFor.push(`Domain (${jobDomain}) is acceptable.`);
    }

    const candExp = parseFloat(profile.yearsOfExperience) || 0;
    let reqExp = 0;
    const expMatch = text.match(/\b(\d+)\s*\+?\s*(?:years?|yrs?)\b/i);
    if (expMatch) {
        reqExp = parseInt(expMatch[1]);
    }
    
    const isSenior = /\b(senior|sr\.?|staff|principal|manager|director|architect|lead)\b/i.test(text);
    const isFresherRole = /\b(intern|internship|fresher|new grad|entry level|graduate|trainee|junior|associate|sde-?1|sde-?i|software development engineer i\b)\b/i.test(text);

    if (isSenior && !isFresherRole && candExp < 3) {
        score -= 60;
        experienceMismatch = true;
        reasonsAgainst.push("Seniority mismatch: Role is for senior/lead, candidate lacks sufficient experience.");
    } else if (isFresherRole) {
        score += 20;
        reasonsFor.push("Direct entry level / fresher / junior role match.");
    }

    const expGap = Math.max(0, reqExp - candExp);
    if (expGap >= 5 && !isFresherRole) {
        score -= 40;
        experienceMismatch = true;
        reasonsAgainst.push(`Experience mismatch: Requires ${reqExp}+ years, candidate has ${candExp}.`);
    }

    if (score < 0) score = 0;
    if (score > 100) score = 100;
    
    let recommendationLevel = "Weak Match";
    if (score >= 90) recommendationLevel = "Excellent Match";
    else if (score >= 80) recommendationLevel = "Strong Match";
    else if (score >= 60) recommendationLevel = "Moderate Match";
    else if (score <= 39) recommendationLevel = "Reject";
    
    const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD) || 70;
    const suitable = score >= MATCH_THRESHOLD && !domainMismatch && !experienceMismatch;

    return {
        score,
        confidence: "Low",
        suitable,
        recommendationLevel,
        reason: `${reasonPrefix}; local scoring yielded ${score}.`,
        primaryReasons: [...reasonsFor, ...reasonsAgainst],
        reasonsFor,
        reasonsAgainst,
        matchedSkills,
        missingSkills,
        skillOverlapPercentage,
        domainMismatch,
        jobDomain,
        domainExplanation: `Domain classified locally as ${jobDomain}.`,
        experienceMismatch,
        scoringBreakdown: {
            roleMatch: skillMatches * 10,
            skillsMatch: skillOverlapPercentage,
            experienceMatch: experienceMismatch ? 0 : 80,
            domainMatch: domainMismatch ? 0 : 80,
            locationMatch: 100
        },
        roleMatch: recommendationLevel,
        recommendation: suitable ? "Consider applying" : "Reject",
        evaluatedBy: "Local",
        provider: "local",
        model: "heuristic",
        fallbackCount: 1,
        fallbackReason: reasonPrefix,
        evaluationMetrics: {
            provider: "Local",
            durationMs: 0,
            fallbackCount: 1,
            failureReason: reasonPrefix
        }
    };
};

/**
 * Multi-Tier Resilient AI Evaluator
 * Tier 1: Gemini 2.5/3.6 Flash (~300ms, natively structured)
 * Tier 2: Groq Key Pool (qwen/qwen3.8-27b / openai/gpt-oss-120b)
 * Tier 3: OpenRouter Free Tier
 * Tier 4: LiteLLM ACA Proxy (if available)
 * Tier 5: Local Heuristic Evaluator
 */
const evaluateJob = async (job, profile, aiState = {}) => {
    const startTime = Date.now();
    let fallbackCount = 0;
    let failureReason = null;
    let providerChain = [];
    const attemptLogs = {};

    if (!aiState.gemini) aiState.gemini = { available: true, requests: 0, success: 0, failed: 0 };
    if (!aiState.groq) aiState.groq = { available: true, requests: 0, success: 0, failed: 0 };
    if (!aiState.openrouter) aiState.openrouter = { available: true, requests: 0, success: 0, failed: 0 };
    if (!aiState.litellm) aiState.litellm = { available: true, requests: 0, success: 0, failed: 0 };
    if (!aiState.local) aiState.local = { requests: 0, success: 0, failed: 0 };

    const MAX_CHARS = 25000;
    let originalDescription = job.description || "";
    let jobForPrompt = job;
    if (originalDescription.length > MAX_CHARS) {
        jobForPrompt = { 
            ...job, 
            description: originalDescription.substring(0, MAX_CHARS) + "\n\n...[TRUNCATED FOR LENGTH]..."
        };
    }
    const prompt = buildEvaluationPrompt(jobForPrompt, profile);
    
    // Check Redis AI Cache (< 2ms)
    try {
        const cached = await RedisCacheService.getCachedEvaluation(job, profile);
        if (cached && typeof cached.score === "number") {
            console.log(chalk.green(`⚡ [Redis AI Cache] Hit for ${job.title || job.role} (Score: ${cached.score}/100)`));
            return {
                ...cached,
                evaluationTimeMs: Date.now() - startTime,
                provider: cached.provider || "cache",
                providerChain: ["RedisCache"]
            };
        }
    } catch (e) {}

    // ==========================================
    // TIER 1: Google Gemini Flash (Primary)
    // ==========================================
    if (aiState.gemini.available && geminiClient && process.env.ENABLE_GEMINI !== "false") {
        providerChain.push("Gemini");
        aiState.gemini.requests++;
        console.log("[AI] Evaluating with Google Gemini Flash...");

        const geminiModels = [
            process.env.GEMINI_MODEL || "gemini-2.5-flash",
            "gemini-3.6-flash",
            "gemini-2.5-flash"
        ];

        for (const modelName of [...new Set(geminiModels)]) {
            try {
                const model = geminiClient.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        temperature: 0.1,
                        responseMimeType: "application/json"
                    }
                });

                const result = await model.generateContent(prompt);
                const content = result.response.text();
                let parsedResult = parseJsonResponse(content);
                parsedResult = validateAiResponse(parsedResult, `Gemini (${modelName})`);

                parsedResult.evaluatedBy = "Gemini";
                parsedResult.provider = "gemini";
                parsedResult.model = modelName;
                parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
                parsedResult.evaluationTimeMs = Date.now() - startTime;
                parsedResult.fallbackCount = fallbackCount;
                parsedResult.providerChain = providerChain;
                parsedResult.attemptLogs = { ...attemptLogs, gemini: 'Success' };
                parsedResult.verificationStatus = "verified";

                aiState.gemini.success++;
                return parsedResult;
            } catch (error) {
                console.warn(`[AI] Gemini model ${modelName} failed:`, error.message);
                const errorAnalysis = analyzeError(error);
                if (errorAnalysis.permanent) {
                    aiState.gemini.available = false;
                    aiState.gemini.reason = errorAnalysis.reason;
                    break;
                }
            }
        }
        fallbackCount++;
        aiState.gemini.failed++;
        attemptLogs.gemini = 'Failed';
    }

    // ==========================================
    // TIER 2: Groq Key Pool (Secondary)
    // ==========================================
    if (aiState.groq.available && process.env.ENABLE_GROQ_FALLBACK !== "false") {
        let groqSuccess = false;
        let groqPoolEntry = getNextGroqClient();

        while (groqPoolEntry && !groqSuccess) {
            providerChain.push(`Groq_Key_${groqPoolEntry.keyIndex}`);
            aiState.groq.requests++;
            console.log(`[AI] Evaluating with Groq (Key #${groqPoolEntry.keyIndex})...`);

            const groqModels = [
                process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
                "openai/gpt-oss-120b",
                "openai/gpt-oss-20b",
                "groq/compound-mini"
            ];

            for (const modelName of groqModels) {
                try {
                    const response = await groqPoolEntry.client.chat.completions.create({
                        model: modelName,
                        messages: [
                            { role: "system", content: "You are a strict job matching engine. Return only valid JSON." },
                            { role: "user", content: prompt }
                        ],
                        temperature: 0.1,
                        response_format: { type: "json_object" }
                    }, { timeout: 15000 });

                    const content = response.choices?.[0]?.message?.content || "";
                    let parsedResult = parseJsonResponse(content);
                    parsedResult = validateAiResponse(parsedResult, `Groq (${modelName})`);

                    parsedResult.evaluatedBy = "Groq";
                    parsedResult.provider = "groq";
                    parsedResult.model = modelName;
                    parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
                    parsedResult.evaluationTimeMs = Date.now() - startTime;
                    parsedResult.fallbackCount = fallbackCount;
                    parsedResult.providerChain = providerChain;
                    parsedResult.attemptLogs = { ...attemptLogs, groq: 'Success' };
                    parsedResult.verificationStatus = "verified";

                    aiState.groq.success++;
                    return parsedResult;
                } catch (error) {
                    console.warn(`[AI] Groq (Key #${groqPoolEntry.keyIndex}, Model ${modelName}) failed:`, error.message);
                    const errorAnalysis = analyzeError(error);
                    if (errorAnalysis.permanent || error.status === 429) {
                        exhaustedGroqKeys.add(groqPoolEntry.apiKey);
                        break; // Try next key in pool
                    }
                }
            }

            groqPoolEntry = getNextGroqClient();
        }

        if (!groqSuccess) {
            fallbackCount++;
            aiState.groq.failed++;
            attemptLogs.groq = 'Failed';
        }
    }

    // ==========================================
    // TIER 3: OpenRouter Free Tier (Tertiary)
    // ==========================================
    if (aiState.openrouter.available && process.env.OPENROUTER_API_KEY && process.env.ENABLE_OPENROUTER_FALLBACK !== "false") {
        providerChain.push("OpenRouter");
        aiState.openrouter.requests++;
        console.log("[AI] Evaluating with OpenRouter Free Tier...");

        const orClient = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
        });

        const orModels = [
            process.env.OPENROUTER_MODEL || "dots-studio/dots-3-note-preview:free",
            "liquid/lfm-2.5-2.6b:free",
            "nvidia/nemotron-3.5-lightning:free",
            "cohere/north-mini-code:free"
        ];

        for (const modelName of orModels) {
            try {
                const response = await orClient.chat.completions.create({
                    model: modelName,
                    messages: [
                        { role: "system", content: "You are a strict job matching engine. Return only valid JSON." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                }, { timeout: 15000 });

                const content = response.choices?.[0]?.message?.content || "";
                let parsedResult = parseJsonResponse(content);
                parsedResult = validateAiResponse(parsedResult, `OpenRouter (${modelName})`);

                parsedResult.evaluatedBy = "OpenRouter";
                parsedResult.provider = "openrouter";
                parsedResult.model = modelName;
                parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
                parsedResult.evaluationTimeMs = Date.now() - startTime;
                parsedResult.fallbackCount = fallbackCount;
                parsedResult.providerChain = providerChain;
                parsedResult.attemptLogs = { ...attemptLogs, openrouter: 'Success' };
                parsedResult.verificationStatus = "verified";

                aiState.openrouter.success++;
                return parsedResult;
            } catch (error) {
                console.warn(`[AI] OpenRouter (${modelName}) failed:`, error.message);
                const errorAnalysis = analyzeError(error);
                if (errorAnalysis.permanent) {
                    aiState.openrouter.available = false;
                    break;
                }
            }
        }
        fallbackCount++;
        aiState.openrouter.failed++;
        attemptLogs.openrouter = 'Failed';
    }

    // ==========================================
    // TIER 4: LiteLLM ACA Proxy (Quaternary)
    // ==========================================
    if (aiState.litellm.available && process.env.LITELLM_BASE_URL) {
        providerChain.push("LiteLLM_Proxy");
        aiState.litellm.requests++;
        try {
            const litellmClient = new OpenAI({
                apiKey: process.env.LITELLM_MASTER_KEY || "dummy-key",
                baseURL: process.env.LITELLM_BASE_URL
            });
            const response = await litellmClient.chat.completions.create({
                model: "job-scorer",
                messages: [
                    { role: "system", content: "You are a strict job matching engine. Return only valid JSON." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            }, { timeout: 8000 });

            const content = response.choices?.[0]?.message?.content || "";
            let parsedResult = parseJsonResponse(content);
            parsedResult = validateAiResponse(parsedResult, "LiteLLM");

            parsedResult.evaluatedBy = "LiteLLM";
            parsedResult.provider = "litellm";
            parsedResult.model = response.model || "job-scorer";
            parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
            parsedResult.evaluationTimeMs = Date.now() - startTime;
            parsedResult.fallbackCount = fallbackCount;
            parsedResult.providerChain = providerChain;
            parsedResult.attemptLogs = { ...attemptLogs, litellm: 'Success' };
            parsedResult.verificationStatus = "verified";

            aiState.litellm.success++;
            return parsedResult;
        } catch (error) {
            console.warn("[AI] LiteLLM Proxy failed:", error.message);
            fallbackCount++;
            aiState.litellm.failed++;
            attemptLogs.litellm = 'Failed';
        }
    }

    // ==========================================
    // TIER 5: Local Heuristic Evaluator (Safety Net)
    // ==========================================
    if (process.env.ENABLE_LOCAL_MATCH_FALLBACK !== "false" && (!aiState.local || !aiState.local.disabled)) {
        providerChain.push("Local");
        aiState.local.requests++;
        aiState.local.success++;
        fallbackCount++;
        console.log("[AI] Using Local Heuristic Evaluator...");

        return await withLogContext({ provider: "Local Heuristic" }, async () => {
            const localResult = evaluateJobLocally(
                job,
                profile,
                failureReason || "Cloud AI evaluation unavailable",
            );
            localResult.evaluationMetrics.durationMs = Date.now() - startTime;
            localResult.evaluationMetrics.fallbackCount = fallbackCount;
            localResult.evaluationTimeMs = Date.now() - startTime;
            localResult.fallbackCount = fallbackCount;
            localResult.fallbackReason = failureReason || "Cloud AI evaluation unavailable";
            localResult.providerChain = providerChain;
            localResult.attemptLogs = { ...attemptLogs, local: 'Success' };
            return localResult;
        });
    }

    return {
        score: 0,
        confidence: "Low",
        suitable: false,
        scoringBreakdown: {
            roleMatch: 0,
            skillsMatch: 0,
            experienceMatch: 0,
            domainMatch: 0,
            locationMatch: 0
        },
        domainMismatch: false,
        domainExplanation: "Evaluation failed",
        experienceMismatch: false,
        primaryReasons: [failureReason || "AI evaluation failed"],
        reason: failureReason || "AI evaluation failed",
        missingSkills: [],
        roleMatch: "Unknown",
        experienceMatch: "Unknown",
        recommendation: "Not Evaluated",
        errorCode: "QUOTA_EXCEEDED",
        evaluatedBy: "None",
        provider: "unknown",
        model: "unknown",
        evaluationTimeMs: Date.now() - startTime,
        fallbackCount,
        fallbackReason: failureReason || "AI evaluation failed",
        providerChain,
        attemptLogs
    };
};

module.exports = {
    evaluateJob,
    evaluateJobLocally
};
