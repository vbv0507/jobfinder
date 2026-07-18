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

const parseJsonResponse = (value = "") => {
    try {
        return JSON.parse(
            value
                .trim()
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim(),
        );
    } catch (e) {
        return { error: "Failed to parse JSON" };
    }
};

const analyzeError = (error) => {
    const msg = (error.message || "").toLowerCase();
    const status = error.status || (error.response ? error.response.status : null);
    
    // Log the complete error object for production observability
    console.error("[Error Audit] Complete Error Object:", {
        status: status,
        code: error.code,
        message: error.message,
        stack: error.stack,
        response: error.response?.data || error.response,
        details: error.details || error
    });

    const is429 = status === 429 || msg.includes("429") || msg.includes("quota");
    const is401 = status === 401 || msg.includes("401") || msg.includes("unauthorized") || msg.includes("unauthenticated");
    const is400 = status === 400 || msg.includes("400") || msg.includes("invalid api key");
    const is403 = status === 403 || msg.includes("403") || msg.includes("billing disabled");

    const isPermanent = is429 || is401 || is400 || is403;

    let reason = "Unknown Error";
    if (is429) reason = "429 Quota";
    else if (is401) reason = "401 Unauthorized";
    else if (is400) reason = "400 Invalid API Key";
    else if (is403) reason = "403 Billing Disabled";
    
    if (isPermanent) {
        return { permanent: true, reason };
    }

    // Temporary errors
    const isTempStatus = [500, 502, 503, 504].includes(status) || msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.includes("too many requests");
    const isNetwork = msg.includes("timeout") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("socket");

    if (isTempStatus || isNetwork) {
        return { permanent: false, reason: "Temporary failures" };
    }

    return { permanent: false, reason: "Unhandled Temporary Error" };
};

module.exports = {
    buildEvaluationPrompt,
    parseJsonResponse,
    analyzeError
};
