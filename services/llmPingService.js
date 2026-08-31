const { OpenAI } = require("openai");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Helper to analyze LLM error responses into accurate status codes & messages
 */
function analyzeLlmError(error) {
    const msg = (error.message || "").toLowerCase();
    const status = error.status || (error.response ? error.response.status : null);
    const responseData = error.response?.data;
    const responseMsg = typeof responseData === "object" ? JSON.stringify(responseData) : (responseData || "");

    const fullErrStr = `${msg} ${responseMsg}`.toLowerCase();

    if (status === 429 || fullErrStr.includes("429") || fullErrStr.includes("quota") || fullErrStr.includes("rate limit") || fullErrStr.includes("resource_exhausted") || fullErrStr.includes("tokens per day")) {
        return {
            status: "quota_exceeded",
            hasCredits: false,
            message: "Out of Credits / Quota Exceeded (Rate Limited)",
            details: error.message
        };
    }

    if (status === 402 || fullErrStr.includes("402") || fullErrStr.includes("insufficient balance") || fullErrStr.includes("payment required") || fullErrStr.includes("no credits remaining")) {
        return {
            status: "quota_exceeded",
            hasCredits: false,
            message: "Payment Required: No API credits remaining",
            details: error.message
        };
    }

    if (status === 401 || status === 403 || fullErrStr.includes("401") || fullErrStr.includes("403") || fullErrStr.includes("unauthorized") || fullErrStr.includes("invalid api key") || fullErrStr.includes("api_key_invalid") || fullErrStr.includes("unauthenticated") || fullErrStr.includes("forbidden")) {
        return {
            status: "invalid_key",
            hasCredits: false,
            message: "Invalid API Key or Unauthorized Access",
            details: error.message
        };
    }

    if (status === 404 || fullErrStr.includes("404") || fullErrStr.includes("model not found") || fullErrStr.includes("unknown model")) {
        return {
            status: "unavailable",
            hasCredits: false,
            message: "Model Not Found or Deprecated",
            details: error.message
        };
    }

    if (fullErrStr.includes("timeout") || fullErrStr.includes("etimedout") || fullErrStr.includes("econnreset") || fullErrStr.includes("econnrefused") || fullErrStr.includes("network")) {
        return {
            status: "unavailable",
            hasCredits: false,
            message: "Network Connection Timeout",
            details: error.message
        };
    }

    return {
        status: "unavailable",
        hasCredits: false,
        message: error.message || "Unknown error during test",
        details: error.message
    };
}

/**
 * Ping Google Gemini
 */
async function pingGemini(customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    if (!apiKey) {
        return {
            id: "gemini",
            name: "Google Gemini",
            category: "Primary Tier 1",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: "GEMINI_API_KEY is not configured in .env"
        };
    }

    const start = Date.now();
    try {
        const client = new GoogleGenerativeAI(apiKey);
        const model = client.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(customPrompt);
        const latencyMs = Date.now() - start;
        const text = result.response.text().trim();

        return {
            id: "gemini",
            name: "Google Gemini",
            category: "Primary Tier 1",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Credits Available"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: "gemini",
            name: "Google Gemini",
            category: "Primary Tier 1",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping a specific Groq Key
 */
async function pingGroqKey(key, keyLabel, keyIndex, customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const modelName = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    if (!key) {
        return {
            id: `groq_key_${keyIndex}`,
            name: `Groq (${keyLabel})`,
            category: "Secondary Tier 2",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: `Key ${keyLabel} is not configured`
        };
    }

    const start = Date.now();
    try {
        const groqClient = new OpenAI({
            apiKey: key,
            baseURL: "https://api.groq.com/openai/v1",
            maxRetries: 0,
            timeout: 6000
        });

        const response = await groqClient.chat.completions.create({
            model: modelName,
            messages: [
                { role: "system", content: "You are a helpful assistant. Keep your response brief." },
                { role: "user", content: customPrompt }
            ],
            max_tokens: 60,
            temperature: 0.1
        }, { timeout: 6000 });

        const latencyMs = Date.now() - start;
        const text = response.choices?.[0]?.message?.content?.trim() || "OK";

        return {
            id: `groq_key_${keyIndex}`,
            name: `Groq (${keyLabel})`,
            category: "Secondary Tier 2",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Credits Available"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: `groq_key_${keyIndex}`,
            name: `Groq (${keyLabel})`,
            category: "Secondary Tier 2",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping all Groq Keys in pool
 */
async function pingGroqPool(customPrompt) {
    const keys = [];
    if (process.env.GROQ_API_KEYS) {
        process.env.GROQ_API_KEYS.split(',').forEach((k, idx) => {
            const trimmed = k.trim();
            if (trimmed && !keys.some(entry => entry.key === trimmed)) {
                keys.push({ key: trimmed, label: `Pool Key #${idx + 1}` });
            }
        });
    }

    ['GROQ_API_KEY', 'GROQ_API_KEY_1', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4'].forEach((envName) => {
        const val = process.env[envName];
        if (val && val.trim() && !keys.some(entry => entry.key === val.trim())) {
            keys.push({ key: val.trim(), label: envName });
        }
    });

    if (keys.length === 0) {
        return [await pingGroqKey(null, "Key #1", 1, customPrompt)];
    }

    const results = await Promise.all(
        keys.map((kObj, idx) => pingGroqKey(kObj.key, kObj.label, idx + 1, customPrompt))
    );
    return results;
}

/**
 * Ping Cerebras
 */
async function pingCerebras(customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const apiKey = process.env.CEREBRAS_API_KEY;
    const modelName = process.env.CEREBRAS_MODEL || "llama-3.3-70b";
    const baseUrl = process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1";

    if (!apiKey) {
        return {
            id: "cerebras",
            name: "Cerebras Inference",
            category: "High-Speed Tier",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: "CEREBRAS_API_KEY is not configured in .env"
        };
    }

    const start = Date.now();
    try {
        const response = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model: modelName,
                messages: [
                    { role: "system", content: "You are a helpful assistant. Keep your response brief." },
                    { role: "user", content: customPrompt }
                ],
                max_tokens: 60,
                temperature: 0.1
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 12000
            }
        );

        const latencyMs = Date.now() - start;
        const text = response.data.choices?.[0]?.message?.content?.trim() || "OK";

        return {
            id: "cerebras",
            name: "Cerebras Inference",
            category: "High-Speed Tier",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Free Tier Credits Available (~2600 T/s)"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: "cerebras",
            name: "Cerebras Inference",
            category: "High-Speed Tier",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping OpenRouter
 */
async function pingOpenRouter(customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const modelName = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
    const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

    if (!apiKey) {
        return {
            id: "openrouter",
            name: "OpenRouter",
            category: "Tertiary Tier 3",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: "OPENROUTER_API_KEY is not configured in .env"
        };
    }

    const start = Date.now();
    try {
        const orClient = new OpenAI({
            apiKey: apiKey,
            baseURL: baseUrl,
            maxRetries: 0,
            timeout: 6000
        });

        const response = await orClient.chat.completions.create({
            model: modelName,
            messages: [
                { role: "system", content: "You are a helpful assistant. Keep your response brief." },
                { role: "user", content: customPrompt }
            ],
            max_tokens: 60,
            temperature: 0.1
        }, { timeout: 6000 });

        const latencyMs = Date.now() - start;
        const text = response.choices?.[0]?.message?.content?.trim() || "OK";

        return {
            id: "openrouter",
            name: "OpenRouter",
            category: "Tertiary Tier 3",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Credits Available"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: "openrouter",
            name: "OpenRouter",
            category: "Tertiary Tier 3",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping DeepSeek
 */
async function pingDeepSeek(customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const modelName = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

    if (!apiKey) {
        return {
            id: "deepseek",
            name: "DeepSeek",
            category: "Fallback Engine",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: "DEEPSEEK_API_KEY is not configured in .env"
        };
    }

    const start = Date.now();
    try {
        const dsClient = new OpenAI({
            apiKey: apiKey,
            baseURL: baseUrl,
            maxRetries: 0,
            timeout: 6000
        });

        const response = await dsClient.chat.completions.create({
            model: modelName,
            messages: [
                { role: "system", content: "You are a helpful assistant. Keep your response brief." },
                { role: "user", content: customPrompt }
            ],
            max_tokens: 60,
            temperature: 0.1
        }, { timeout: 6000 });

        const latencyMs = Date.now() - start;
        const text = response.choices?.[0]?.message?.content?.trim() || "OK";

        return {
            id: "deepseek",
            name: "DeepSeek",
            category: "Fallback Engine",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Credits Available"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: "deepseek",
            name: "DeepSeek",
            category: "Fallback Engine",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping Z.ai (GLM)
 */
async function pingZai(customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const apiKey = process.env.ZAI_API_KEY;
    const modelName = process.env.ZAI_MODEL || "glm-4.5-air";
    const baseUrl = process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4/chat/completions";

    if (!apiKey) {
        return {
            id: "zai",
            name: "Z.ai (GLM)",
            category: "Fallback Engine",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: "ZAI_API_KEY is not configured in .env"
        };
    }

    const start = Date.now();
    try {
        const response = await axios.post(
            baseUrl,
            {
                model: modelName,
                messages: [
                    { role: "system", content: "You are a helpful assistant. Keep your response brief." },
                    { role: "user", content: customPrompt }
                ],
                max_tokens: 60,
                temperature: 0.1
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 6000
            }
        );

        const latencyMs = Date.now() - start;
        const text = response.data.choices?.[0]?.message?.content?.trim() || "OK";

        return {
            id: "zai",
            name: "Z.ai (GLM)",
            category: "Fallback Engine",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Credits Available"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: "zai",
            name: "Z.ai (GLM)",
            category: "Fallback Engine",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping LiteLLM Proxy
 */
async function pingLiteLLM(customPrompt = "Hello! Please reply with a short confirmation that your API connection is active.") {
    const baseUrl = process.env.LITELLM_BASE_URL;
    const apiKey = process.env.LITELLM_MASTER_KEY || "dummy-key";
    const modelName = "job-scorer";

    if (!baseUrl) {
        return {
            id: "litellm",
            name: "LiteLLM ACA Proxy",
            category: "Proxy Gateway",
            configured: false,
            model: modelName,
            status: "not_configured",
            hasCredits: false,
            latencyMs: 0,
            reply: null,
            message: "LITELLM_BASE_URL is not configured in .env"
        };
    }

    const start = Date.now();
    try {
        const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const response = await axios.post(
            url,
            {
                model: modelName,
                messages: [
                    { role: "system", content: "You are a helpful assistant. Keep your response brief." },
                    { role: "user", content: customPrompt }
                ],
                max_tokens: 60,
                temperature: 0.1
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 5000
            }
        );

        const latencyMs = Date.now() - start;
        const text = response.data?.choices?.[0]?.message?.content?.trim() || "OK";

        return {
            id: "litellm",
            name: "LiteLLM ACA Proxy",
            category: "Proxy Gateway",
            configured: true,
            model: modelName,
            status: "healthy",
            hasCredits: true,
            latencyMs,
            reply: text,
            message: "Operational & Routing Active"
        };
    } catch (error) {
        const latencyMs = Date.now() - start;
        const analysis = analyzeLlmError(error);
        return {
            id: "litellm",
            name: "LiteLLM ACA Proxy",
            category: "Proxy Gateway",
            configured: true,
            model: modelName,
            status: analysis.status,
            hasCredits: analysis.hasCredits,
            latencyMs,
            reply: null,
            message: analysis.message,
            error: analysis.details
        };
    }
}

/**
 * Ping a single provider by ID
 */
async function pingProviderById(providerId, prompt) {
    const testPrompt = prompt && prompt.trim() ? prompt.trim() : "Hello! Please reply with a short confirmation that your API connection is active.";

    if (providerId === "gemini") {
        return [await pingGemini(testPrompt)];
    }
    if (providerId.startsWith("groq")) {
        if (providerId === "groq") {
            return await pingGroqPool(testPrompt);
        }
        const keyIndex = parseInt(providerId.replace("groq_key_", ""), 10) || 1;
        const groqResults = await pingGroqPool(testPrompt);
        const match = groqResults.find(r => r.id === providerId) || groqResults[keyIndex - 1] || groqResults[0];
        return match ? [match] : groqResults;
    }
    if (providerId === "cerebras") {
        return [await pingCerebras(testPrompt)];
    }
    if (providerId === "openrouter") {
        return [await pingOpenRouter(testPrompt)];
    }
    if (providerId === "deepseek") {
        return [await pingDeepSeek(testPrompt)];
    }
    if (providerId === "zai") {
        return [await pingZai(testPrompt)];
    }
    if (providerId === "litellm") {
        return [await pingLiteLLM(testPrompt)];
    }

    return await pingAllProviders(testPrompt);
}

/**
 * Ping All Configured & Fallback Providers
 */
async function pingAllProviders(prompt) {
    const testPrompt = prompt && prompt.trim() ? prompt.trim() : "Hello! Please reply with a short confirmation that your API connection is active.";

    const [geminiRes, groqList, cerebrasRes, openrouterRes, deepseekRes, zaiRes, litellmRes] = await Promise.all([
        pingGemini(testPrompt),
        pingGroqPool(testPrompt),
        pingCerebras(testPrompt),
        pingOpenRouter(testPrompt),
        pingDeepSeek(testPrompt),
        pingZai(testPrompt),
        pingLiteLLM(testPrompt)
    ]);

    const allResults = [
        geminiRes,
        ...(Array.isArray(groqList) ? groqList : [groqList]),
        cerebrasRes,
        openrouterRes,
        deepseekRes,
        zaiRes,
        litellmRes
    ];

    return allResults;
}

/**
 * Get Provider Metadata (Safe for frontend without exposing secrets)
 */
function getProvidersMetadata() {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasGroq = !!(process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY_1);
    const hasCerebras = !!process.env.CEREBRAS_API_KEY;
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    const hasZai = !!process.env.ZAI_API_KEY;
    const hasLiteLlm = !!process.env.LITELLM_BASE_URL;

    return [
        { id: "gemini", name: "Google Gemini", configured: hasGemini, model: process.env.GEMINI_MODEL || "gemini-2.5-flash", category: "Primary Tier 1" },
        { id: "groq", name: "Groq Key Pool", configured: hasGroq, model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", category: "Secondary Tier 2" },
        { id: "cerebras", name: "Cerebras Inference", configured: hasCerebras, model: process.env.CEREBRAS_MODEL || "llama-3.3-70b", category: "High-Speed Tier" },
        { id: "openrouter", name: "OpenRouter", configured: hasOpenRouter, model: process.env.OPENROUTER_MODEL || "dots-studio/dots-3-note-preview:free", category: "Tertiary Tier 3" },
        { id: "deepseek", name: "DeepSeek", configured: hasDeepSeek, model: process.env.DEEPSEEK_MODEL || "deepseek-chat", category: "Fallback Engine" },
        { id: "zai", name: "Z.ai (GLM)", configured: hasZai, model: process.env.ZAI_MODEL || "glm-4.5-air", category: "Fallback Engine" },
        { id: "litellm", name: "LiteLLM ACA Proxy", configured: hasLiteLlm, model: "job-scorer", category: "Proxy Gateway" }
    ];
}

module.exports = {
    pingGemini,
    pingGroqPool,
    pingGroqKey,
    pingCerebras,
    pingOpenRouter,
    pingDeepSeek,
    pingZai,
    pingLiteLLM,
    pingProviderById,
    pingAllProviders,
    getProvidersMetadata
};
