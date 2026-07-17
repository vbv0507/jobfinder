const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const { classifyDomain } = require("../utils/domains");

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

const buildEvaluationPrompt = (job, profile) => `
You are an expert Technical Recruiter, ATS Analyzer, and Hiring Manager.

Your task is to critically evaluate whether this candidate is a strong match for the job. Do not be overly optimistic.

========================
CANDIDATE PROFILE
========================

Career Stage: ${profile.careerStage || "Not specified"}
Years of Experience: ${profile.yearsOfExperience || 0}
Preferred Domains: ${(profile.preferredDomains || []).join(", ")}
Excluded Domains: ${(profile.excludedDomains || []).join(", ")}
Preferred Employment Levels: ${(profile.preferredEmploymentLevels || []).join(", ")}
Preferred Job Types: ${(profile.preferredJobTypes || []).join(", ")}

Graduation Year:
${profile.graduationYear}

Skills:
${profile.skills.join(", ")}

Preferred Roles:
${profile.preferredRoles.join(", ")}

Preferred Locations:
${profile.preferredLocations.join(", ")}

========================
JOB DETAILS
========================

Title:
${job.title}

Location:
${job.location}

Description:
${job.description}

========================
EVALUATION RULES (MULTI-STAGE)
========================

STAGE 1: EXPERIENCE LEVEL & GRADUATION MISMATCH
- The candidate graduates in ${profile.graduationYear} (Years of Exp: ${profile.yearsOfExperience}).
- Check if the job aligns with Preferred Employment Levels.
- HEAVILY PENALIZE (score < 40) if the job requires mandatory experience exceeding the candidate's years of experience or if it demands a Senior/Manager/Lead title.

STAGE 2: DOMAIN MATCHING
- CLASSIFY the job into a primary engineering domain (e.g., Backend, Frontend, Mobile, AI/ML, DevOps, Data Engineering).
- Compare against the candidate's Preferred Domains and Excluded Domains.
- HEAVILY PENALIZE (domainMatch < 40) if the job's primary domain is in the Excluded Domains list.

STAGE 3: SKILL MATCHING
- Identify MUST-HAVE vs BONUS skills.
- If a MUST-HAVE tech stack is entirely missing from the candidate, apply a strong penalty.
- If the candidate has strong Backend (Node.js/Express) and the role requires Java/Python/Go for Backend, treat it as a learnable gap, but still reduce the score slightly compared to an exact match.

STAGE 4: SCORING
90-100 = Excellent Match (Exact tech stack, entry-level/intern, perfect domain)
80-89 = Strong Match (Backend domain, learnable tech stack gap, entry-level)
70-79 = Good Match (Acceptable domain, some skill overlap)
40-69 = Weak Match (Some domain or experience mismatch, missing core required skills)
0-39 = Reject (Clear domain mismatch like AI/Mobile, or requires Senior/3+ years experience)

========================
RESPONSE FORMAT
========================

Return ONLY valid JSON using this exact schema. DO NOT return markdown, explanations, or code blocks.

{
  "score": 0,
  "confidence": "High|Medium|Low",
  "suitable": true|false,
  "scoringBreakdown": {
    "roleMatch": 0,
    "skillsMatch": 0,
    "experienceMatch": 0,
    "domainMatch": 0,
    "locationMatch": 0
  },
  "domainMismatch": true|false,
  "domainExplanation": "Explain why this domain matches or mismatches the profile",
  "jobDomain": "What is the primary domain of this job? (e.g. BACKEND, FRONTEND, DATA ENGINEERING)",
  "experienceMismatch": boolean,
  "roleMatch": "Strong, Moderate, or Weak",
  "missingSkills": ["List only critical missing REQUIRED skills"],
  "primaryReasons": ["Point 1 explaining exactly why the score was given", "Point 2"],
  "reason": "One sentence summary of the decision",
  "recommendation": "Short recruiter recommendation"
}
`;

const parseJsonResponse = (value = "") =>
    JSON.parse(
        value
            .trim()
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim(),
    );

const evaluateJobWithGroq = async (job, profile) => {
    if (
        process.env.ENABLE_GROQ_FALLBACK === "false" ||
        !process.env.GROQ_API_KEY
    ) {
        return null;
    }

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
            timeout: 30000,
        },
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    let parsed = parseJsonResponse(content);
    if (typeof parsed.score !== "number") parsed.score = parseInt(parsed.score) || 0;
    parsed.evaluatedBy = "Groq";
    parsed.provider = "groq";
    parsed.model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    return parsed;
};



const analyzeError = (error) => {
    const msg = (error.message || "").toLowerCase();
    const status = error.status || (error.response ? error.response.status : null);
    
    // Check for permanent errors
    const isPermanent = 
        msg.includes("429") || 
        msg.includes("quota") || 
        msg.includes("too many requests") || 
        msg.includes("invalid api key") ||
        msg.includes("api key not valid") ||
        msg.includes("unauthenticated") ||
        msg.includes("unauthorized") ||
        msg.includes("billing") ||
        msg.includes("disabled") ||
        status === 429 ||
        status === 401 ||
        status === 403 ||
        status === 400;

    let reason = "Unknown Error";
    if (msg.includes("quota") || status === 429 || msg.includes("429") || msg.includes("too many requests")) reason = "Quota Exceeded";
    else if (msg.includes("key") || status === 401 || status === 403 || status === 400 || msg.includes("unauthenticated") || msg.includes("unauthorized")) reason = "Authentication Failed";
    else if (msg.includes("billing")) reason = "Billing Disabled";
    
    if (isPermanent) {
        return { permanent: true, reason };
    }

    // Temporary errors
    const isTemporary =
        msg.includes("timeout") ||
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("dns") ||
        msg.includes("network") ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status >= 500;
        
    return { permanent: false, reason: isTemporary ? "Temporary Network/API Issue" : "Unhandled Temporary Error" };
};

const evaluateJob = async (job, profile, aiState = { gemini: { available: true }, groq: { available: true } }) => {
    const startTime = Date.now();
    let fallbackCount = 0;
    let failureReason = null;

    if (aiState.gemini.available) {
        aiState.geminiRequests = (aiState.geminiRequests || 0) + 1;
        try {
            const result = await model.generateContent(buildEvaluationPrompt(job, profile));
            let parsedResult = parseJsonResponse(result.response.text());
            
            if (typeof parsedResult.score !== "number") parsedResult.score = parseInt(parsedResult.score) || 0;
            parsedResult.evaluatedBy = "Gemini";
            parsedResult.jobDomain = parsedResult.jobDomain || classifyDomain(getText(job));
            
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

            return parsedResult;
        } catch (error) {
            const errorAnalysis = analyzeError(error);

            if (errorAnalysis.permanent) {
                console.log(`[AI] Gemini disabled for this pipeline.\nReason: ${errorAnalysis.reason}.`);
                aiState.gemini.available = false;
                aiState.gemini.reason = errorAnalysis.reason;
                aiState.gemini.disabledAt = new Date();
            } else {
                console.log(`[AI] Gemini temporary failure: ${errorAnalysis.reason}.\nFalling back to Groq.\nProvider remains available.`);
            }

            aiState.geminiFallbacks = (aiState.geminiFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = `Gemini failed: ${errorAnalysis.reason}`;
            console.error("Gemini Evaluation Error:", error.message);
        }
    } else {
        aiState.geminiFallbacks = (aiState.geminiFallbacks || 0) + 1;
        fallbackCount++;
        failureReason = `Gemini disabled: ${aiState.gemini.reason}`;
    }

    if (aiState.groq.available && (process.env.ENABLE_GROQ_FALLBACK === "true" || process.env.ENABLE_GROQ_FALLBACK !== "false")) {
        aiState.groqRequests = (aiState.groqRequests || 0) + 1;
        try {
            console.log("Trying Groq fallback.");
            const groqAnalysis = await evaluateJobWithGroq(job, profile);

            if (groqAnalysis) {
                groqAnalysis.evaluationMetrics = {
                    provider: "Groq",
                    durationMs: Date.now() - startTime,
                    fallbackCount,
                    failureReason
                };
                groqAnalysis.evaluationTimeMs = Date.now() - startTime;
                groqAnalysis.fallbackCount = fallbackCount;
                groqAnalysis.fallbackReason = failureReason;
                return groqAnalysis;
            }
        } catch (groqError) {
            const errorAnalysis = analyzeError(groqError);

            if (errorAnalysis.permanent) {
                console.log(`[AI] Groq disabled for this pipeline.\nReason: ${errorAnalysis.reason}.`);
                aiState.groq.available = false;
                aiState.groq.reason = errorAnalysis.reason;
                aiState.groq.disabledAt = new Date();
            } else {
                console.log(`[AI] Groq temporary failure: ${errorAnalysis.reason}.\nFalling back to Local.\nProvider remains available.`);
            }

            aiState.groqFallbacks = (aiState.groqFallbacks || 0) + 1;
            fallbackCount++;
            failureReason = `Groq failed: ${errorAnalysis.reason}`;
            console.error("Groq Evaluation Error:", groqError.message);
        }
    } else if (!aiState.groq.available) {
        aiState.groqFallbacks = (aiState.groqFallbacks || 0) + 1;
        fallbackCount++;
        failureReason = failureReason ? `${failureReason} | Groq disabled: ${aiState.groq.reason}` : `Groq disabled: ${aiState.groq.reason}`;
    }

    if (process.env.ENABLE_LOCAL_MATCH_FALLBACK !== "false") {
        aiState.localRequests = (aiState.localRequests || 0) + 1;
        fallbackCount++;
        console.log("Using local match fallback.");
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
        return localResult;
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
        fallbackReason: failureReason || "AI evaluation failed"
    };
};

module.exports = {
    evaluateJob,
};
