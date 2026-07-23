const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const { classifyDomain } = require("../utils/domains");
const { evaluateJobWithZai } = require("./zaiService");
const { buildEvaluationPrompt, parseJsonResponse, analyzeError, validateAiResponse } = require("./aiHelpers");
const { withLogContext } = require("../utils/logger");
const { withRetry } = require("../utils/retry");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
});

const getText = (job) =>
    [job.title, job.location, job.experience, job.description, job.employmentType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

const countMatches = (text, values = []) =>
    values.filter((value) => text.includes(value.toLowerCase())).length;

const evaluateJobLocally = (job, profile, reasonPrefix = "Gemini unavailable") => {
    const text = getText(job);
    let score = 35;
    const missingSkills = [];
    let domainMismatch = false;
    let experienceMismatch = false;
    const primaryReasons = [];

    const roleMatches = countMatches(text, profile.preferredRoles || []);
    const skillMatches = countMatches(text, profile.skills || []);

    const jobDomain = classifyDomain(text);
    const excludedDomains = (profile.excludedDomains || []).map(d => d.toUpperCase());
    
    if (excludedDomains.includes(jobDomain)) {
        domainMismatch = true;
        score -= 50;
        primaryReasons.push(`Domain mismatch: Role classified as ${jobDomain}, which is excluded by the candidate.`);
    }

    if (roleMatches > 0) score += 22;
    if (/\b(software development engineer|software engineer|sde|backend|api developer|node\.?js developer)\b/i.test(text)) {
        score += 18;
    }
    if (/\b(intern|internship|fresher|new grad|entry level|junior|associate)\b|0\s*-\s*1|0\s*to\s*1/i.test(text)) {
        score += 14;
    }
    if (/\b(india|bengaluru|bangalore|noida|hyderabad|pune|remote)\b/i.test(text)) {
        score += 10;
    }
    if (skillMatches > 0) {
        score += Math.min(skillMatches * 3, 15);
    }

    if (/\b(senior|sr\.?|staff|principal|manager|director|architect|lead)\b/i.test(text)) {
        score -= 50;
        experienceMismatch = true;
        primaryReasons.push("Seniority mismatch: Role is for senior/lead, candidate is a fresher.");
    }
    const hasMandatoryExperience = /\b(minimum|mandatory|requires|required)\s*\d+\s*(?:years?|yrs?)\b/i.test(text);
    if (/\b(2|3|4|5|6|7|8|9|10)\s*\+?\s*(?:years?|yrs?)\b|1\s*(?:-|to)\s*3\s*(?:years?|yrs?)/i.test(text) || hasMandatoryExperience) {
        score -= 20;
        experienceMismatch = true;
        primaryReasons.push("Experience mismatch: Requires more experience than candidate possesses.");
    }

    if (!/\bnode\.?js|express|mongodb|javascript|rest api|api|backend\b/i.test(text) && !domainMismatch) {
        missingSkills.push("Direct Node.js/Express/MongoDB mention not found in job post");
    }

    if (score < 0) score = 0;
    if (score > 100) score = 100;

    return {
        score,
        confidence: "Low",
        suitable: score >= 50 && !domainMismatch && !experienceMismatch,
        reason: `${reasonPrefix}; local scoring yielded ${score}.`,
        primaryReasons: primaryReasons.length > 0 ? primaryReasons : ["Local keyword analysis"],
        missingSkills,
        domainMismatch,
        jobDomain,
        evaluatedBy: "Local",
        domainExplanation: `Domain classified locally as ${jobDomain}.`,
        experienceMismatch,
        scoringBreakdown: {
            roleMatch: roleMatches * 10,
            skillsMatch: skillMatches * 10,
            experienceMatch: experienceMismatch ? 0 : 80,
            domainMatch: domainMismatch ? 0 : 80,
            locationMatch: 100
        },
        roleMatch: roleMatches > 0 ? "Strong" : "Weak",
        experienceMatch: experienceMismatch ? "Mismatch" : "Match",
        recommendation: score >= 50 ? "Consider applying" : "Not recommended",
        evaluatedBy: "Local",
        provider: "local",
        model: "heuristic",
        fallbackCount: 2,
        fallbackReason: reasonPrefix,
        evaluationMetrics: {
            provider: "Local",
            durationMs: 0,
            fallbackCount: 2,
            failureReason: reasonPrefix
        }
    };
};

const evaluateJobWithGroq = async (job, profile) => {
    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a strict job matching engine. Return only valid JSON.",
                },
                {
                    role: "user",
                    content: buildEvaluationPrompt(job, profile),
                },
            ],
            temperature: 0.1,
            response_format: { type: "json_object" },
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            timeout: 15000,
        },
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    let parsed = parseJsonResponse(content);
    parsed = validateAiResponse(parsed, "Groq");
    parsed.evaluatedBy = "Groq";
    parsed.provider = "groq";
    parsed.model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    return parsed;
};





const evaluateJob = async (job, profile, aiState = { gemini: { available: true }, groq: { available: true }, zai: { available: true } }) => {
    const startTime = Date.now();
    let fallbackCount = 0;
    let failureReason = null;
    let providerChain = [];

    // 1. Gemini
    if (aiState.gemini.available && process.env.GEMINI_API_KEY) {
        console.log("[AI] Trying Gemini");
        providerChain.push("Gemini");
        aiState.gemini.requests = (aiState.gemini.requests || 0) + 1;
        try {
            return await withLogContext({ provider: "Gemini" }, async () => {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini timeout exceeded")), 15000));
            const generatePromise = model.generateContent(buildEvaluationPrompt(job, profile));
            const result = await Promise.race([generatePromise, timeoutPromise]);
            
            let parsedResult = parseJsonResponse(result.response.text());
            
            parsedResult = validateAiResponse(parsedResult, "Gemini");
            
            parsedResult.evaluatedBy = "Gemini";
            parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
            
            aiState.gemini.success = (aiState.gemini.success || 0) + 1;
            
            parsedResult.evaluationMetrics = {
                provider: "Gemini",
                durationMs: Date.now() - startTime,
                fallbackCount,
                failureReason: null
            };

            parsedResult.provider = "gemini";
            parsedResult.model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
            parsedResult.evaluationTimeMs = Date.now() - startTime;
            parsedResult.fallbackCount = fallbackCount;
            parsedResult.fallbackReason = null;
            parsedResult.providerChain = providerChain;

            return parsedResult;
            }); // End withLogContext
        } catch (error) {
            aiState.gemini.failed = (aiState.gemini.failed || 0) + 1;
            const errorAnalysis = analyzeError(error);

            if (errorAnalysis.permanent) {
                console.log(`[AI] Gemini disabled for this pipeline.\nReason: ${errorAnalysis.reason}.`);
                aiState.gemini.available = false;
                aiState.gemini.disabled = true;
                aiState.gemini.reason = errorAnalysis.reason;
                aiState.gemini.disabledAt = new Date();
            } else {
                console.log(`[AI] Gemini temporary failure: ${errorAnalysis.reason}.\nFalling back to Groq.\nProvider remains available.`);
            }

            aiState.geminiFallbacks = (aiState.geminiFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = `Gemini failed: ${errorAnalysis.reason}`;
            console.log("[AI] Gemini Failed");
            console.error("Gemini Evaluation Error:", error.message);
        }
    } else {
        failureReason = `Gemini disabled${aiState.gemini.reason ? ': ' + aiState.gemini.reason : ''}`;
    }

    // 2. Groq
    if (aiState.groq.available && process.env.ENABLE_GROQ_FALLBACK !== "false" && process.env.GROQ_API_KEY) {
        providerChain.push("Groq");
        aiState.groq.requests = (aiState.groq.requests || 0) + 1;
        try {
            console.log("[AI] Trying Groq");
            return await withLogContext({ provider: "Groq" }, async () => {
            const groqAnalysis = await withRetry(() => evaluateJobWithGroq(job, profile), { maxRetries: 3 });

            if (!groqAnalysis) throw new Error("Groq returned empty response");

            aiState.groq.success = (aiState.groq.success || 0) + 1;
            groqAnalysis.evaluationMetrics = {
                provider: "Groq",
                durationMs: Date.now() - startTime,
                fallbackCount,
                failureReason
            };
            groqAnalysis.evaluationTimeMs = Date.now() - startTime;
            groqAnalysis.fallbackCount = fallbackCount;
            groqAnalysis.fallbackReason = failureReason;
            groqAnalysis.providerChain = providerChain;
            return groqAnalysis;
            }); // End withLogContext
        } catch (groqError) {
            aiState.groq.failed = (aiState.groq.failed || 0) + 1;
            const errorAnalysis = analyzeError(groqError);

            if (errorAnalysis.permanent) {
                console.log(`[AI] Groq disabled for this pipeline.\nReason: ${errorAnalysis.reason}.`);
                aiState.groq.available = false;
                aiState.groq.disabled = true;
                aiState.groq.reason = errorAnalysis.reason;
                aiState.groq.disabledAt = new Date();
            } else {
                console.log(`[AI] Groq temporary failure: ${errorAnalysis.reason}.\nFalling back to Z.ai.\nProvider remains available.`);
            }

            aiState.groqFallbacks = (aiState.groqFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = failureReason ? `${failureReason} | Groq failed: ${errorAnalysis.reason}` : `Groq failed: ${errorAnalysis.reason}`;
            console.log("[AI] Groq Failed");
            console.error("Groq Evaluation Error:", groqError.message);
        }
    } else if (!aiState.groq.available) {
        failureReason = failureReason ? `${failureReason} | Groq disabled${aiState.groq.reason ? ': ' + aiState.groq.reason : ''}` : `Groq disabled${aiState.groq.reason ? ': ' + aiState.groq.reason : ''}`;
    }

    // 3. Z.ai
    if (aiState.zai.available && process.env.ENABLE_ZAI_FALLBACK !== "false" && process.env.ZAI_API_KEY) {
        providerChain.push("Z.ai");
        aiState.zai.requests = (aiState.zai.requests || 0) + 1;
        try {
            console.log("[AI] Trying Z.ai");
            return await withLogContext({ provider: "Z.ai" }, async () => {
            const zaiAnalysis = await withRetry(() => evaluateJobWithZai(job, profile), { maxRetries: 3 });

            if (!zaiAnalysis) throw new Error("Z.ai returned empty response");

            aiState.zai.success = (aiState.zai.success || 0) + 1;
            zaiAnalysis.evaluationMetrics = {
                provider: "Z.ai",
                durationMs: Date.now() - startTime,
                fallbackCount,
                failureReason
            };
            zaiAnalysis.evaluationTimeMs = Date.now() - startTime;
            zaiAnalysis.fallbackCount = fallbackCount;
            zaiAnalysis.fallbackReason = failureReason;
            zaiAnalysis.provider = "zai";
            zaiAnalysis.providerChain = providerChain;
            return zaiAnalysis;
            }); // End withLogContext
        } catch (zaiError) {
            aiState.zai.failed = (aiState.zai.failed || 0) + 1;
            const errorAnalysis = analyzeError(zaiError);

            if (errorAnalysis.permanent) {
                console.log(`[AI] Z.ai disabled for this pipeline.\nReason: ${errorAnalysis.reason}.`);
                aiState.zai.available = false;
                aiState.zai.disabled = true;
                aiState.zai.reason = errorAnalysis.reason;
                aiState.zai.disabledAt = new Date();
            } else {
                console.log(`[AI] Z.ai temporary failure: ${errorAnalysis.reason}.\nFalling back to Local.\nProvider remains available.`);
            }

            aiState.zaiFallbacks = (aiState.zaiFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = failureReason ? `${failureReason} | Z.ai failed: ${errorAnalysis.reason}` : `Z.ai failed: ${errorAnalysis.reason}`;
            console.log("[AI] Z.ai Failed");
            console.error("Z.ai Evaluation Error:", zaiError.message);
        }
    } else if (!aiState.zai.available) {
        failureReason = failureReason ? `${failureReason} | Z.ai disabled${aiState.zai.reason ? ': ' + aiState.zai.reason : ''}` : `Z.ai disabled${aiState.zai.reason ? ': ' + aiState.zai.reason : ''}`;
    }

    // 4. Local
    if (process.env.ENABLE_LOCAL_MATCH_FALLBACK !== "false") {
        providerChain.push("Local");
        if (!aiState.local) aiState.local = {};
        aiState.local.requests = (aiState.local.requests || 0) + 1;
        aiState.local.success = (aiState.local.success || 0) + 1;
        fallbackCount++;
        console.log("[AI] Using Local Heuristic");
        return await withLogContext({ provider: "Local Heuristic" }, async () => {
        const localResult = evaluateJobLocally(
            job,
            profile,
            failureReason || "AI evaluation failed",
        );
        localResult.evaluationMetrics.durationMs = Date.now() - startTime;
        localResult.evaluationMetrics.fallbackCount = fallbackCount;
        localResult.evaluationTimeMs = Date.now() - startTime;
        localResult.fallbackCount = fallbackCount;
        localResult.fallbackReason = failureReason || "AI evaluation failed";
        localResult.providerChain = providerChain;
        return localResult;
        }); // End withLogContext
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
        evaluationMetrics: {
            provider: "None",
            durationMs: Date.now() - startTime,
            fallbackCount,
            failureReason: failureReason || "AI evaluation failed"
        },
        provider: "unknown",
        model: "unknown",
        evaluationTimeMs: Date.now() - startTime,
        fallbackCount,
        fallbackReason: failureReason || "AI evaluation failed",
        providerChain
    };
};

module.exports = {
    evaluateJob
};
