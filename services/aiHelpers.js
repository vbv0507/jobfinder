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
        msg.includes("permission denied") ||
        msg.includes("model unavailable") ||
        status === 429 ||
        status === 401 ||
        status === 403 ||
        status === 400;

    let reason = "Unknown Error";
    if (msg.includes("quota") || status === 429 || msg.includes("429") || msg.includes("too many requests")) reason = "Quota Exceeded";
    else if (msg.includes("key") || status === 401 || status === 403 || status === 400 || msg.includes("unauthenticated") || msg.includes("unauthorized")) reason = "Authentication Failed";
    else if (msg.includes("billing")) reason = "Billing Disabled";
    else if (msg.includes("permission denied")) reason = "Permission Denied";
    else if (msg.includes("model unavailable")) reason = "Model Unavailable";
    
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
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;
        
    return { permanent: false, reason: isTemporary ? "Temporary Network/API Issue" : "Unhandled Temporary Error" };
};

module.exports = {
    buildEvaluationPrompt,
    parseJsonResponse,
    analyzeError
};
