const axios = require("axios");
const { buildEvaluationPrompt, parseJsonResponse, validateAiResponse } = require("./aiHelpers");

/**
 * OpenRouter evaluation service.
 * Aggregates 300+ models via a single OpenAI-compatible endpoint.
 * Free tier: Use models with ":free" suffix — no credit card required.
 * Sign up free: https://openrouter.ai
 *
 * Free models available:
 *   - meta-llama/llama-3.3-70b-instruct:free
 *   - mistralai/mistral-7b-instruct:free
 *   - google/gemma-3-27b-it:free
 */
const evaluateJobWithOpenRouter = async (job, profile) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

    const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
    const baseUrl = "https://openrouter.ai/api/v1";

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
                "HTTP-Referer": "https://rolenova.app",
                "X-Title": "RoleNova Job Evaluator",
            },
            timeout: 20000,
        }
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    let parsed = parseJsonResponse(content);

    parsed = validateAiResponse(parsed, "OpenRouter");
    parsed.evaluatedBy = "OpenRouter";
    parsed.provider = "openrouter";
    parsed.model = model;
    return parsed;
};

module.exports = { evaluateJobWithOpenRouter };
