const axios = require("axios");
const { buildEvaluationPrompt, parseJsonResponse, validateAiResponse } = require("./aiHelpers");

const evaluateJobWithZai = async (job, profile) => {

    const apiUrl = process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4/chat/completions";
    const model = process.env.ZAI_MODEL || "glm-4.5-air";

    const response = await axios.post(
        apiUrl,
        {
            model: model,
            messages: [
                {
                    role: "system",
                    content: "You are a strict job matching engine. Return only valid JSON.",
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
                Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            timeout: 15000,
        },
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    let parsed = parseJsonResponse(content);

    parsed = validateAiResponse(parsed, "Z.ai");
    
    parsed.evaluatedBy = "Z.ai";
    return parsed;
};

module.exports = {
    evaluateJobWithZai,
};
