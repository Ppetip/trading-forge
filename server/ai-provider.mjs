export const AI_MODELS = Object.freeze({
  preflightClassifier: process.env.OPENROUTER_PREFLIGHT_MODEL ?? "openai/gpt-5.4-nano",
  preflightFallback: "google/gemini-2.5-flash-lite"
});

export async function callOpenRouterJson({ model, messages, temperature = 0, fetchImpl = fetch, apiKey = process.env.OPENROUTER_API_KEY }) {
  if (!apiKey) {
    const error = new Error("OpenRouter API key is not configured.");
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: ["Bearer", apiKey].join(" "),
      "http-referer": process.env.EDGELAB_APP_URL ?? "http://localhost",
      "x-title": "EdgeLab"
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: "json_object" },
      messages
    })
  });
  if (!response.ok) {
    const error = new Error(`OpenRouter request failed with HTTP ${response.status}.`);
    error.code = "AI_PROVIDER_FAILED";
    error.status = 502;
    throw error;
  }
  const payload = await response.json();
  return parseJson(payload?.choices?.[0]?.message?.content);
}

function parseJson(content) {
  const text = String(content ?? "").trim();
  try { return JSON.parse(text); } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    throw new Error("AI provider returned malformed JSON.");
  }
}
