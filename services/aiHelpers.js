const buildEvaluationPrompt = (job, profile) => `
You are an expert Technical Recruiter and ATS Analyzer. Your task is to critically evaluate whether this candidate is a strong match for the job. Do not be overly optimistic.

========================
CANDIDATE PROFILE
========================

Career Stage: ${profile.careerStage || "Not specified"}
Years of Experience: ${profile.yearsOfExperience || 0}
Preferred Domains: ${(profile.preferredDomains || []).join(", ")}
Excluded Domains: ${(profile.excludedDomains || []).join(", ")}

Graduation Year:
${profile.graduationYear}

Candidate Skills:
${profile.skills.join(", ")}

========================
JOB DETAILS
========================

Title: ${job.title}
Location: ${job.location}

Description:
${job.description}

========================
MANDATORY REQUIREMENT EXTRACTION (DO THIS FIRST)
========================
Before scoring, extract the following from the Job Details:
1. Required Years of Experience (e.g., "5+ years", "0-2 years")
2. Mandatory Skills/Technologies (e.g., "Kubernetes, Linux, Python")
3. Required Domains
4. Keywords like "Must Have", "Required", "Minimum Qualifications"

========================
EVALUATION RULES (MULTI-STAGE)
========================

STAGE 1: EXPERIENCE MISMATCH (HARD CONSTRAINT)
- Experience must be treated as a HARD CONSTRAINT.
- Candidate Years of Experience: ${profile.yearsOfExperience || 0}.
- If the candidate is a Fresher (0 years) AND the Job requires 5+ years: The final score MUST NOT exceed 40. Reject immediately.
- Recognize senior titles (Senior, Staff, Lead, Principal, Architect, Manager, Director, Production Engineer, Site Reliability Engineer, Platform Engineer, Infrastructure Engineer). If the role implies seniority and the candidate is junior/fresher, apply SEVERE penalties (score < 40).
- Experience Gap Penalty:
  - Gap <= 1 year: 0 penalty
  - Gap 2-3 years: -20 penalty
  - Gap 4-5 years: -40 penalty
  - Gap >= 6 years: -60 penalty or Reject

STAGE 2: MANDATORY SKILL MATCHING
- Compare Candidate Skills vs Extracted Mandatory Skills.
- Treat Keywords ("Required", "Must Have") as hard constraints.
- Calculate skill overlap percentage. Example: If Candidate has 2 out of 10 required skills, overlap is 20%.
- If skill overlap is < 40% for mandatory tech stacks, apply strong penalty.

STAGE 3: DOMAIN CLASSIFICATION
- Classify the job into a primary domain (Backend, Frontend, Full Stack, Data Engineering, ML, AI, DevOps, Cloud, Platform Engineering, SRE, Cyber Security, etc.).
- If Candidate Domain differs significantly from Job Domain (e.g., Backend candidate vs Production Engineering role), apply penalty.

STAGE 4: SCORING & RECOMMENDATION
Calculate the final score based on penalties.
Determine Recommendation Level:
- Excellent Match (90-100)
- Strong Match (80-89)
- Moderate Match (60-79)
- Weak Match (40-59)
- Reject (0-39)

Never ignore experience. Never ignore mandatory skills. Never inflate score because the company is famous.

========================
RESPONSE FORMAT
========================
Return ONLY valid JSON using this exact schema. DO NOT return markdown, explanations, or code blocks.

{
  "score": 0,
  "confidence": "High|Medium|Low",
  "suitable": true|false,
  "recommendationLevel": "Excellent Match|Strong Match|Moderate Match|Weak Match|Reject",
  "scoringBreakdown": {
    "roleMatch": 0,
    "skillsMatch": 0,
    "experienceMatch": 0,
    "domainMatch": 0,
    "locationMatch": 0
  },
  "domainMismatch": true|false,
  "domainExplanation": "Explain domain alignment or penalty",
  "jobDomain": "Primary Domain",
  "experienceMismatch": true|false,
  "roleMatch": "Strong|Moderate|Weak|Reject",
  "skillOverlapPercentage": 0,
  "matchedSkills": ["Skill 1", "Skill 2"],
  "missingSkills": ["Missing Skill 1", "Missing Skill 2"],
  "strengths": ["Strong domain knowledge", "Meets experience requirements"],
  "weaknesses": ["Lacks cloud experience", "No mention of Redis"],
  "mandatoryRequirements": ["Must have 5+ years experience", "Must know Kubernetes"],
  "optionalRequirements": ["Nice to have AWS", "Nice to have React"],
  "reasonsFor": ["Reason 1 FOR candidate", "Reason 2 FOR candidate"],
  "reasonsAgainst": ["Reason 1 AGAINST candidate", "Reason 2 AGAINST candidate"],
  "primaryReasons": ["Combined reasoning point 1", "Combined reasoning point 2"],
  "reason": "One sentence summary of the decision",
  "recommendation": "Final Recommendation (e.g. Reject)"
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
    const is402 = status === 402 || msg.includes("402") || msg.includes("payment required") || msg.includes("insufficient balance") || msg.includes("no credit");
    const is400 = status === 400 || msg.includes("400") || msg.includes("invalid api key");
    const is403 = status === 403 || msg.includes("403") || msg.includes("billing disabled");

    const isPermanent = is429 || is401 || is402 || is400 || is403;

    let reason = "Unknown Error";
    if (is429) reason = "429 Quota";
    else if (is401) reason = "401 Unauthorized";
    else if (is402) reason = "402 Payment Required (no balance)";
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

const validateAiResponse = (parsed, providerName) => {
    if (!parsed || typeof parsed !== "object" || parsed.error) {
        throw new Error(`Invalid JSON response from ${providerName}`);
    }
    if (parsed.score === undefined || parsed.score === null || isNaN(parseInt(parsed.score))) {
        throw new Error(`Score is missing or invalid from ${providerName}`);
    }
    if (!parsed.reason || typeof parsed.reason !== "string" || parsed.reason.trim() === "") {
        throw new Error(`Reasoning is missing or empty from ${providerName}`);
    }
    parsed.score = parseInt(parsed.score);
    
    // Ensure new fields have defaults
    parsed.matchedSkills = Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : [];
    parsed.missingSkills = Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [];
    parsed.strengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
    parsed.weaknesses = Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [];
    parsed.mandatoryRequirements = Array.isArray(parsed.mandatoryRequirements) ? parsed.mandatoryRequirements : [];
    parsed.optionalRequirements = Array.isArray(parsed.optionalRequirements) ? parsed.optionalRequirements : [];
    parsed.reasonsFor = Array.isArray(parsed.reasonsFor) ? parsed.reasonsFor : [];
    parsed.reasonsAgainst = Array.isArray(parsed.reasonsAgainst) ? parsed.reasonsAgainst : [];
    parsed.primaryReasons = Array.isArray(parsed.primaryReasons) ? parsed.primaryReasons : [];
    parsed.skillOverlapPercentage = typeof parsed.skillOverlapPercentage === "number" ? parsed.skillOverlapPercentage : 0;
    parsed.recommendationLevel = parsed.recommendationLevel || "Moderate Match";
    parsed.roleMatch = parsed.roleMatch || parsed.recommendationLevel || "Moderate";
    
    return parsed;
};

module.exports = {
    buildEvaluationPrompt,
    parseJsonResponse,
    analyzeError,
    validateAiResponse
};
