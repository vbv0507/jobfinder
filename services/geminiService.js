const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

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

    const roleMatches = countMatches(text, profile.preferredRoles || []);
    const skillMatches = countMatches(text, profile.skills || []);

    if (roleMatches > 0) score += 22;
    if (/\b(software development engineer|software engineer|sde|backend|api developer|node\.?js developer)\b/i.test(text)) {
        score += 18;
    }
    if (/\b(intern|internship|fresher|graduate|new grad|entry level|junior|associate)\b|0\s*-\s*1|0\s*to\s*1/i.test(text)) {
        score += 14;
    }
    if (/\b(india|bengaluru|bangalore|noida|hyderabad|pune|remote)\b/i.test(text)) {
        score += 10;
    }
    if (skillMatches > 0) {
        score += Math.min(skillMatches * 3, 15);
    }

    if (/\b(senior|sr\.?|staff|principal|manager|director|architect|lead)\b/i.test(text)) {
        score -= 28;
    }
    if (/\b(2|3|4|5|6|7|8|9|10)\s*\+?\s*(?:years?|yrs?)\b|1\s*(?:-|to)\s*3\s*(?:years?|yrs?)/i.test(text)) {
        score -= 22;
    }

    if (!/\bnode\.?js|express|mongodb|javascript|rest api|api|backend\b/i.test(text)) {
        missingSkills.push("Direct Node.js/Express/MongoDB mention not found in job post");
    }

    score = Math.max(0, Math.min(100, score));

    return {
        score,
        suitable: score >= Number(process.env.MATCH_THRESHOLD || 70),
        reason: `${reasonPrefix}; local scoring found ${roleMatches} role signal(s) and ${skillMatches} skill signal(s).`,
        missingSkills,
        roleMatch: roleMatches > 0 ? "Aligned with preferred backend/SDE roles" : "Partial software role match",
        experienceMatch: "Fresher or 0-1 year signal required",
        recommendation:
            score >= Number(process.env.MATCH_THRESHOLD || 70)
                ? "Apply after tailoring resume to the listed backend stack"
                : "Review manually before applying",
        evaluatedBy: "local-fallback",
    };
};

const buildEvaluationPrompt = (job, profile) => `
You are an expert Technical Recruiter, ATS Analyzer, and Hiring Manager.

Your task is to evaluate whether this candidate is a strong match for the job.

========================
CANDIDATE PROFILE
========================

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
EVALUATION RULES
========================

1. Give higher scores for:
   - Backend Development
   - Node.js
   - Express.js
   - MongoDB
   - JavaScript
   - REST APIs
   - Strong DSA/problem-solving foundation
   - Production backend projects, authentication, cron jobs, CI/CD, cloud deployment
   - Software Development Engineer roles
   - Backend Engineer roles
   - Software Engineer roles
   - Internship opportunities
   - New Graduate opportunities
   - Fresher opportunities
   - 0-1 years experience
   - SDE I / Software Engineer I only when the job does not require more than 1 year
   - India or Remote jobs

For fresher, intern, new-grad, entry-level, junior, associate, or 0-1 year roles, do not reject only because the exact backend stack differs.
If the candidate has strong backend projects, REST APIs, DSA, C++/JavaScript, and cloud/deployment experience, treat Java/Python/Postgres/AWS gaps as learnable missing skills instead of a hard rejection.

2. Give lower scores for:
   - Senior roles
   - Manager positions
   - Roles requiring more than 1 year experience, including 1-3, 2+, or 3+ years
   - Roles requiring unrelated technologies
   - Non-India roles unless truly remote

3. Analyze:
   - Skill Match
   - Role Match
   - Experience Match
   - Location Match
   - Career Growth Potential

4. Score from 0 to 100.

Scoring Guide:

90-100 = Excellent Match
80-89 = Strong Match
70-79 = Good Match
60-69 = Average Match
Below 60 = Reject

5. suitable should be:
   - true if score >= 70
   - false if score < 70

6. missingSkills should contain only important missing skills.

7. reason should be concise and recruiter-style.

========================
RESPONSE FORMAT
========================

Return ONLY valid JSON.

{
  "score": 0,
  "suitable": true,
  "reason": "",
  "missingSkills": [],
  "roleMatch": "",
  "experienceMatch": "",
  "recommendation": ""
}

DO NOT return markdown.
DO NOT return explanations.
DO NOT wrap JSON in code blocks.
Return ONLY the JSON object.
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
    return {
        ...parseJsonResponse(content),
        evaluatedBy: "groq",
    };
};

// Gemini receives one job and one candidate profile.
// It returns a JSON score that tells whether the job should be shown to the user.
const evaluateJob = async (job, profile) => {
    try {
        const result = await model.generateContent(buildEvaluationPrompt(job, profile));

        return {
            ...parseJsonResponse(result.response.text()),
            evaluatedBy: "gemini",
        };
    } catch (error) {
        const isQuotaError =
            error.message.includes("429") ||
            error.message.toLowerCase().includes("quota") ||
            error.message.toLowerCase().includes("too many requests");

        if (isQuotaError || process.env.ENABLE_GROQ_FALLBACK === "true") {
            try {
                console.log("Gemini unavailable; trying Groq fallback.");
                const groqAnalysis = await evaluateJobWithGroq(job, profile);

                if (groqAnalysis) {
                    return groqAnalysis;
                }
            } catch (groqError) {
                console.log(`Groq fallback failed: ${groqError.message}`);
            }
        }

        if (process.env.ENABLE_LOCAL_MATCH_FALLBACK !== "false") {
            console.log("Using local match fallback.");
            return evaluateJobLocally(
                job,
                profile,
                isQuotaError ? "Gemini quota exceeded" : "AI evaluation failed",
            );
        }

        console.error("Gemini Evaluation Error:", error.message);

        return {
            score: 0,
            suitable: false,
            reason: isQuotaError
                ? "Gemini quota exceeded"
                : "Gemini evaluation failed",
            missingSkills: [],
            roleMatch: "Unknown",
            experienceMatch: "Unknown",
            recommendation: "Not Evaluated",
            errorCode: isQuotaError ? "QUOTA_EXCEEDED" : "GEMINI_FAILED",
        };
    }
};

module.exports = {
    evaluateJob,
};
