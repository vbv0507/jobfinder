const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
});

// Gemini receives one job and one candidate profile.
// It returns a JSON score that tells whether the job should be shown to the user.
const evaluateJob = async (job, profile) => {
    try {
        const prompt = `
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
   - Software Development Engineer roles
   - Backend Engineer roles
   - Software Engineer roles
   - Internship opportunities
   - New Graduate opportunities
   - Fresher opportunities
   - 0-1 years experience

2. Give lower scores for:
   - Senior roles
   - Manager positions
   - Roles requiring 2+ years experience
   - Roles requiring unrelated technologies

3. Analyze:
   - Skill Match
   - Role Match
   - Experience Match
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

        const result = await model.generateContent(prompt);

        const responseText = result.response
            .text()
            .trim()
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        return JSON.parse(responseText);

    } catch (error) {
        console.error("Gemini Evaluation Error:", error.message);

        const isQuotaError =
            error.message.includes("429") ||
            error.message.toLowerCase().includes("quota") ||
            error.message.toLowerCase().includes("too many requests");

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
