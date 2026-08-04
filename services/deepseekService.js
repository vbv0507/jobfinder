const axios = require("axios");
const { buildEvaluationPrompt, parseJsonResponse, validateAiResponse } = require("./aiHelpers");

/**
 * DeepSeek V4 Flash evaluation service.
 * Uses the OpenAI-compatible API at https://api.deepseek.com
 */
const evaluateJobWithDeepSeek = async (job, profile) => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured");

    const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

    const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
            model,
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
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: 20000,
        }
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    let parsed = parseJsonResponse(content);

    parsed = validateAiResponse(parsed, "DeepSeek");
    parsed.evaluatedBy = "DeepSeek";
    parsed.provider = "deepseek";
    parsed.model = model;
    return parsed;
};

module.exports = { evaluateJobWithDeepSeek };
