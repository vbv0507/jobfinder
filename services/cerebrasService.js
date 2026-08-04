const axios = require("axios");
const { buildEvaluationPrompt, parseJsonResponse, validateAiResponse } = require("./aiHelpers");

/**
 * Cerebras Inference evaluation service.
 * Free tier: 1,000,000 tokens/day — no credit card required.
 * OpenAI-compatible API at https://api.cerebras.ai/v1
 * Speed: ~2600 tokens/second (fastest available)
 * Sign up: https://cloud.cerebras.ai
 */
const evaluateJobWithCerebras = async (job, profile) => {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) throw new Error("CEREBRAS_API_KEY not configured");

    const model = process.env.CEREBRAS_MODEL || "llama-3.3-70b";
    const baseUrl = process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1";

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
            timeout: 15000,
        }
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    let parsed = parseJsonResponse(content);

    parsed = validateAiResponse(parsed, "Cerebras");
    parsed.evaluatedBy = "Cerebras";
    parsed.provider = "cerebras";
    parsed.model = model;
    return parsed;
};

module.exports = { evaluateJobWithCerebras };
