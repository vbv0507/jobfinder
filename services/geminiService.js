const { OpenAI } = require("openai");
const axios = require("axios");
const { classifyDomain } = require("../utils/domains");

const { buildEvaluationPrompt, parseJsonResponse, analyzeError, validateAiResponse } = require("./aiHelpers");
const { withLogContext } = require("../utils/logger");

const litellmClient = new OpenAI({
    apiKey: process.env.LITELLM_MASTER_KEY || "dummy-key", 
    baseURL: process.env.LITELLM_BASE_URL || "http://localhost:4000/v1"
});

const getText = (job) =>
    [job.title, job.location, job.experience, job.description, job.employmentType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

const countMatches = (text, values = []) =>
    values.filter((value) => text.includes(value.toLowerCase())).length;

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

    const jobDomain = classifyDomain(text);
    const excludedDomains = (profile.excludedDomains || []).map(d => d.toUpperCase());
    
    if (excludedDomains.includes(jobDomain)) {
        domainMismatch = true;
        score -= 50;
        reasonsAgainst.push(`Domain mismatch: Role classified as ${jobDomain}, which is excluded by the candidate.`);
    } else {
        reasonsFor.push(`Domain (${jobDomain}) is acceptable.`);
    }

    const candExp = parseFloat(profile.yearsOfExperience) || 0;
    let reqExp = 0;
    
    const expMatch = text.match(/\b(\d+)\s*\+?\s*(?:years?|yrs?)\b/i);
    if (expMatch) {
        reqExp = parseInt(expMatch[1]);
    }
    
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
    
    if (candExp === 0 && reqExp >= 5) {
        score = Math.min(score, 35);
        experienceMismatch = true;
        reasonsAgainst.push("HARD CONSTRAINT: Fresher applied to a role requiring 5+ years experience.");
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

const evaluateJob = async (job, profile, aiState = { litellm: { available: true } }) => {
    const startTime = Date.now();
    let fallbackCount = 0;
    let failureReason = null;
    let providerChain = [];
    const attemptLogs = { litellm: 'Skipped', local: 'Skipped' };

    if (!aiState.litellm) aiState.litellm = { available: true };

    if (aiState.litellm.available) {
        console.log("[AI] Routing request through LiteLLM...");
        providerChain.push("LiteLLM_Proxy");
        aiState.litellm.requests = (aiState.litellm.requests || 0) + 1;

        try {
            return await withLogContext({ provider: "LiteLLM" }, async () => {
                const MAX_CHARS = 25000;
                let originalDescription = job.description || "";
                let jobForPrompt = job;
                
                if (originalDescription.length > MAX_CHARS) {
                    console.log(`[AI] Truncating job description from ${originalDescription.length} to ${MAX_CHARS} characters.`);
                    jobForPrompt = { 
                        ...job, 
                        description: originalDescription.substring(0, MAX_CHARS) + "\n\n...[TRUNCATED FOR LENGTH]..."
                    };
                }
                
                const prompt = buildEvaluationPrompt(jobForPrompt, profile);
                
                const { data, response: rawResponse } = await litellmClient.chat.completions.create({
                    model: "job-scorer",
                    messages: [
                        { role: "system", content: "You are a strict job matching engine. Return only valid JSON." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                }, { timeout: 35000 }).withResponse();
                
                const content = data.choices?.[0]?.message?.content || "";
                let parsedResult = parseJsonResponse(content);
                parsedResult = validateAiResponse(parsedResult, "LiteLLM");
                
                const actualModel = data.model || "unknown";
                let actualProvider = "litellm";
                if (actualModel.includes("cerebras")) actualProvider = "cerebras";
                else if (actualModel.includes("groq")) actualProvider = "groq";
                else if (actualModel.includes("openrouter")) actualProvider = "openrouter";

                parsedResult.evaluatedBy = "LiteLLM";
                parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
                
                aiState.litellm.success = (aiState.litellm.success || 0) + 1;
                
                parsedResult.evaluationMetrics = {
                    provider: actualProvider,
                    durationMs: Date.now() - startTime,
                    fallbackCount: 0,
                    failureReason: null
                };

                parsedResult.provider = actualProvider;
                parsedResult.model = actualModel;
                parsedResult.evaluationTimeMs = Date.now() - startTime;
                parsedResult.fallbackCount = 0;
                parsedResult.fallbackReason = null;
                parsedResult.providerChain = [actualProvider];
                
                attemptLogs.litellm = 'Success';
                parsedResult.attemptLogs = attemptLogs;

                return parsedResult;
            });
        } catch (error) {
            aiState.litellm.failed = (aiState.litellm.failed || 0) + 1;
            const errorAnalysis = analyzeError(error);
            
            fallbackCount++;
            failureReason = `LiteLLM failed: ${errorAnalysis.reason}`;
            attemptLogs.litellm = `Failed: ${errorAnalysis.reason}`;
            console.log(`[AI] LiteLLM Failed: ${error.message}`);
        }
    }

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
