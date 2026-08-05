const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const { classifyDomain } = require("../utils/domains");
const { evaluateJobWithOpenRouter } = require("./openrouterService");

const { buildEvaluationPrompt, parseJsonResponse, analyzeError, validateAiResponse } = require("./aiHelpers");
const { withLogContext } = require("../utils/logger");
const { withRetry } = require("../utils/retry");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Groq key pool — supports rotation across multiple keys
// Set GROQ_API_KEYS=key1,key2,key3 in .env for rotation, or falls back to GROQ_API_KEY
const buildGroqKeyPool = () => {
    const multi = process.env.GROQ_API_KEYS || '';
    const single = process.env.GROQ_API_KEY || '';
    const keys = multi.split(',').map(k => k.trim()).filter(Boolean);
    if (single && !keys.includes(single)) keys.unshift(single);
    return keys;
};
const GROQ_KEY_POOL = buildGroqKeyPool();

const buildOpenRouterKeyPool = () => {
    const multi = process.env.OPENROUTER_API_KEYS || '';
    const single = process.env.OPENROUTER_API_KEY || '';
    const keys = multi.split(',').map(k => k.trim()).filter(Boolean);
    if (single && !keys.includes(single)) keys.unshift(single);
    return keys;
};
const OPENROUTER_KEY_POOL = buildOpenRouterKeyPool();

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
    let score = 50;
    const missingSkills = [];
    const matchedSkills = [];
    const reasonsFor = [];
    const reasonsAgainst = [];
    
    let domainMismatch = false;
    let experienceMismatch = false;

    // 1. Mandatory Skills Extraction & Match
    const profileSkills = (profile.skills || []).map(s => s.toLowerCase());
    const commonTechs = ["node.js", "express", "mongodb", "react", "python", "java", "aws", "kubernetes", "docker", "sql", "linux", "jenkins", "argocd", "slurm"];
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
    
    const skillOverlapPercentage = requiredSkills.length > 0 ? Math.round((skillMatches / requiredSkills.length) * 100) : 100;
    
    if (skillOverlapPercentage < 40 && requiredSkills.length > 0) {
        score -= 15;
        reasonsAgainst.push(`Low skill overlap (${skillOverlapPercentage}%). Missing: ${missingSkills.join(", ")}`);
    } else if (skillMatches > 0) {
        score += 20;
        reasonsFor.push(`Strong skill match (${skillOverlapPercentage}% overlap)`);
    }

    // 2. Domain Classification
    const jobDomain = classifyDomain(text);
    const excludedDomains = (profile.excludedDomains || []).map(d => d.toUpperCase());
    
    if (excludedDomains.includes(jobDomain)) {
        domainMismatch = true;
        score -= 50;
        reasonsAgainst.push(`Domain mismatch: Role classified as ${jobDomain}, which is excluded by the candidate.`);
    } else {
        reasonsFor.push(`Domain (${jobDomain}) is acceptable.`);
    }

    // 3. Experience Extraction & Penalty
    const candExp = parseFloat(profile.yearsOfExperience) || 0;
    let reqExp = 0;
    
    // Extract req exp
    const expMatch = text.match(/\b(\d+)\s*\+?\s*(?:years?|yrs?)\b/i);
    if (expMatch) {
        reqExp = parseInt(expMatch[1]);
    }
    
    // Senior titles
    const isSenior = /\b(senior|sr\.?|staff|principal|manager|director|architect|lead|production engineer|site reliability engineer|platform engineer|infrastructure engineer)\b/i.test(text);
    
    if (isSenior && candExp < 3) {
        score -= 60;
        experienceMismatch = true;
        reasonsAgainst.push("Seniority mismatch: Role is for senior/lead, candidate lacks sufficient experience.");
    }
    
    const expGap = reqExp - candExp;
    if (expGap >= 6) {
        score -= 40;
        experienceMismatch = true;
        reasonsAgainst.push(`Experience mismatch: Requires ${reqExp}+ years, candidate has ${candExp} (Gap: ${expGap}).`);
    } else if (expGap >= 4) {
        score -= 20;
        experienceMismatch = true;
        reasonsAgainst.push(`Experience mismatch: Requires ${reqExp}+ years, candidate has ${candExp} (Gap: ${expGap}).`);
    } else if (expGap >= 2) {
        score -= 10;
        reasonsAgainst.push(`Experience gap: Requires ${reqExp}+ years, candidate has ${candExp}.`);
    } else {
        reasonsFor.push(`Experience level aligns with role requirements.`);
    }
    
    // Hard constraint check: Fresher applying for 5+ years
    if (candExp === 0 && reqExp >= 5) {
        score = Math.min(score, 35);
        experienceMismatch = true;
        reasonsAgainst.push("HARD CONSTRAINT: Fresher applied to a role requiring 5+ years experience.");
    }

    // Bounds
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

const evaluateJobWithGroq = async (job, profile, apiKey) => {
    const keyToUse = apiKey || process.env.GROQ_API_KEY;
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
                Authorization: `Bearer ${keyToUse}`,
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





const evaluateJob = async (job, profile, aiState = { gemini: { available: true }, groq: { available: true }, openrouter: { available: true } }) => {
    const startTime = Date.now();
    let fallbackCount = 0;
    let failureReason = null;
    let providerChain = [];
    const attemptLogs = { gemini: 'Skipped', groq: 'Skipped', openrouter: 'Skipped', local: 'Skipped' };

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
            attemptLogs.gemini = 'Success';
            parsedResult.attemptLogs = attemptLogs;

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
            attemptLogs.gemini = `Failed: ${errorAnalysis.reason}`;
            console.log("[AI] Gemini Failed");
            console.error("Gemini Evaluation Error:", error.message);
        }
    } else {
        failureReason = `Gemini disabled${aiState.gemini.reason ? ': ' + aiState.gemini.reason : ''}`;
    }

    // 2. Groq (with key pool rotation)
    if (aiState.groq.available && process.env.ENABLE_GROQ_FALLBACK !== "false" && GROQ_KEY_POOL.length > 0) {
        providerChain.push("Groq");
        aiState.groq.requests = (aiState.groq.requests || 0) + 1;

        // Track exhausted key indices in aiState
        if (!aiState.groq.exhaustedKeys) aiState.groq.exhaustedKeys = new Set();

        let groqSucceeded = false;
        for (let ki = 0; ki < GROQ_KEY_POOL.length; ki++) {
            if (aiState.groq.exhaustedKeys.has(ki)) continue; // skip already exhausted keys
            const keyToUse = GROQ_KEY_POOL[ki];
            const keyLabel = `key[${ki + 1}/${GROQ_KEY_POOL.length}]`;
            try {
                console.log(`[AI] Trying Groq ${keyLabel}`);
                const result = await withLogContext({ provider: "Groq" }, async () => {
                    const groqAnalysis = await withRetry(() => evaluateJobWithGroq(job, profile, keyToUse), { maxRetries: 0 });
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
                    attemptLogs.groq = `Success (${keyLabel})`;
                    groqAnalysis.attemptLogs = attemptLogs;
                    return groqAnalysis;
                });
                groqSucceeded = true;
                return result;
            } catch (groqError) {
                const errorAnalysis = analyzeError(groqError);
                if (errorAnalysis.permanent || groqError?.response?.status === 429) {
                    console.log(`[AI] Groq ${keyLabel} quota exhausted. Rotating to next key...`);
                    aiState.groq.exhaustedKeys.add(ki);
                } else {
                    console.log(`[AI] Groq ${keyLabel} temporary failure: ${errorAnalysis.reason}`);
                    break; // non-quota error, don't rotate — move to next provider
                }
            }
        }

        if (!groqSucceeded) {
            // All Groq keys exhausted
            const allGroqExhausted = aiState.groq.exhaustedKeys.size >= GROQ_KEY_POOL.length;
            if (allGroqExhausted) {
                console.log(`[AI] All ${GROQ_KEY_POOL.length} Groq key(s) exhausted. Disabling Groq for this pipeline.`);
                aiState.groq.available = false;
                aiState.groq.disabled = true;
                aiState.groq.reason = '429 Quota (all keys)';
                aiState.groq.disabledAt = new Date();
            }
            aiState.groq.failed = (aiState.groq.failed || 0) + 1;
            aiState.groqFallbacks = (aiState.groqFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = failureReason ? `${failureReason} | Groq failed` : `Groq failed (all keys exhausted)`;
            attemptLogs.groq = 'Failed: all keys exhausted';
            console.log("[AI] Groq Failed — moving to OpenRouter");
        }
    } else if (!aiState.groq.available) {
        failureReason = failureReason ? `${failureReason} | Groq disabled${aiState.groq.reason ? ': ' + aiState.groq.reason : ''}` : `Groq disabled${aiState.groq.reason ? ': ' + aiState.groq.reason : ''}`;
    }

    // 3. OpenRouter (FREE — no credit card required)
    if (!aiState.openrouter) aiState.openrouter = { available: true };
    if (aiState.openrouter.available && process.env.ENABLE_OPENROUTER_FALLBACK !== "false" && OPENROUTER_KEY_POOL.length > 0) {
        providerChain.push("OpenRouter");
        aiState.openrouter.requests = (aiState.openrouter.requests || 0) + 1;

        // Track exhausted key indices in aiState
        if (!aiState.openrouter.exhaustedKeys) aiState.openrouter.exhaustedKeys = new Set();

        let openRouterSucceeded = false;
        for (let ki = 0; ki < OPENROUTER_KEY_POOL.length; ki++) {
            if (aiState.openrouter.exhaustedKeys.has(ki)) continue; // skip already exhausted keys
            const keyToUse = OPENROUTER_KEY_POOL[ki];
            const keyLabel = `key[${ki + 1}/${OPENROUTER_KEY_POOL.length}]`;
            try {
                console.log(`[AI] Trying OpenRouter ${keyLabel}`);
                const result = await withLogContext({ provider: "OpenRouter" }, async () => {
                    const orAnalysis = await withRetry(() => evaluateJobWithOpenRouter(job, profile, keyToUse), { maxRetries: 0 });
                    if (!orAnalysis) throw new Error("OpenRouter returned empty response");
                    aiState.openrouter.success = (aiState.openrouter.success || 0) + 1;
                    orAnalysis.evaluationMetrics = {
                        provider: "OpenRouter",
                        durationMs: Date.now() - startTime,
                        fallbackCount,
                        failureReason
                    };
                    orAnalysis.evaluationTimeMs = Date.now() - startTime;
                    orAnalysis.fallbackCount = fallbackCount;
                    orAnalysis.fallbackReason = failureReason;
                    orAnalysis.provider = "openrouter";
                    orAnalysis.providerChain = providerChain;
                    attemptLogs.openrouter = `Success (${keyLabel})`;
                    orAnalysis.attemptLogs = attemptLogs;
                    return orAnalysis;
                });
                openRouterSucceeded = true;
                return result;
            } catch (orError) {
                const errorAnalysis = analyzeError(orError);
                if (errorAnalysis.permanent || orError?.response?.status === 429) {
                    console.log(`[AI] OpenRouter ${keyLabel} quota exhausted. Rotating to next key...`);
                    aiState.openrouter.exhaustedKeys.add(ki);
                } else {
                    console.log(`[AI] OpenRouter ${keyLabel} temporary failure: ${errorAnalysis.reason}`);
                    break; // non-quota error, don't rotate — move to next provider
                }
            }
        }

        if (!openRouterSucceeded) {
            // All OpenRouter keys exhausted
            const allOpenRouterExhausted = aiState.openrouter.exhaustedKeys.size >= OPENROUTER_KEY_POOL.length;
            if (allOpenRouterExhausted) {
                console.log(`[AI] All ${OPENROUTER_KEY_POOL.length} OpenRouter key(s) exhausted. Disabling OpenRouter for this pipeline.`);
                aiState.openrouter.available = false;
                aiState.openrouter.disabled = true;
                aiState.openrouter.reason = '429 Quota (all keys)';
                aiState.openrouter.disabledAt = new Date();
            }
            aiState.openrouter.failed = (aiState.openrouter.failed || 0) + 1;
            aiState.openrouterFallbacks = (aiState.openrouterFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = failureReason ? `${failureReason} | OpenRouter failed` : `OpenRouter failed (all keys exhausted)`;
            attemptLogs.openrouter = 'Failed: all keys exhausted';
            console.log("[AI] OpenRouter Failed — moving to Local");
        }
    } else if (!aiState.openrouter.available) {
        failureReason = failureReason ? `${failureReason} | OpenRouter disabled${aiState.openrouter.reason ? ': ' + aiState.openrouter.reason : ''}` : `OpenRouter disabled${aiState.openrouter.reason ? ': ' + aiState.openrouter.reason : ''}`;
    }

    // 5. Local
    if (process.env.ENABLE_LOCAL_MATCH_FALLBACK !== "false" && (!aiState.local || !aiState.local.disabled)) {
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
        attemptLogs.local = 'Success';
        localResult.attemptLogs = attemptLogs;
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
        providerChain,
        attemptLogs
    };
};

module.exports = {
    evaluateJob
};
