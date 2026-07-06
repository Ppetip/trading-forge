import { parseStrategyPrompt } from "./prompt-parser.mjs";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma3:12b";

function jsonFromResponse(content) {
  const text = String(content ?? "").trim();
  try { return JSON.parse(text); } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    throw new Error("Ollama returned invalid JSON.");
  }
}

export async function parseStrategyPromptWithOllama(prompt, defaults = {}, {
  fetchImpl = fetch,
  baseUrl = process.env.OLLAMA_URL ?? DEFAULT_URL,
  model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL
} = {}) {
  const baseline = parseStrategyPrompt(prompt, defaults);
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, format: "json", options: { temperature: 0 },
      messages: [
        { role: "system", content: "You are the strategy clarifier for a one-click historical validator. Convert the user idea into objective backtest rules with practical research defaults. Unless explicitly overridden: test the latest completed 1 year, include every eligible Monday through Friday, use the continuous front futures contract, interpret stated session times in America/New_York, confirm breakouts on candle close, allow one trade per day, and include fees and slippage. Never invent a weekday restriction such as Mondays-only. You convert trading strategy descriptions into objective backtest rules. Return JSON only, with keys: rules, assumptions, untestable, clarificationNeeded. Preserve the supplied rule keys and value types. Never invent market data or results. Treat explanatory or promotional prose as context, not executable rules. If a later setup section gives numeric thresholds, candle conditions, stops, and exits, those objective rules override earlier phrases such as high probability, overextended, exhaustion, or reversion. Only put a condition in untestable when it is required for execution and remains undefined after reading the full prompt." },
        { role: "user", content: JSON.stringify({ prompt: String(prompt ?? ""), defaults, baselineRules: baseline.rules }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`Ollama request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const generated = jsonFromResponse(payload.message?.content);
  const generatedRules = generated?.rules && typeof generated.rules === "object" ? generated.rules : {};
  const rules = Object.fromEntries(Object.entries(baseline.rules).map(([key, value]) => {
    const candidate = generatedRules[key];
    return [key, typeof candidate === typeof value ? candidate : value];
  }));
  const rawAssumptions = Array.isArray(generated.assumptions) ? generated.assumptions.map(String) : baseline.assumptions;
  const assumptions = rawAssumptions.filter((item) => !/\b(valid indicator|accurately reflects|reliable measure|meaningful baseline|high probability)\b/i.test(item));
  const rawUntestable = Array.isArray(generated.untestable) ? generated.untestable.map(String) : baseline.untestable;
  const objectiveSignals = [
    /bollinger.{0,30}\b20\b.{0,20}\b2\b/i,
    /rsi.{0,20}(?:below\s*30|above\s*70|oversold|overbought)/i,
    /closes?\s+(?:below|above)/i,
    /1\.5\s*(?:x|\\times|times)?.{0,12}atr/i,
    /take profit.{0,60}(?:moving average|middle|center|baseline)/i
  ].filter((pattern) => pattern.test(String(prompt))).length;
  const untestable = objectiveSignals >= 3
    ? rawUntestable.filter((item) => /\b(missing|not specified|undefined|repaint|unavailable data|cannot be measured)\b/i.test(item))
    : rawUntestable;
  return {
    parser: `ollama:${model}`,
    rules,
    assumptions,
    untestable,
    clarificationNeeded: typeof generated.clarificationNeeded === "boolean" ? generated.clarificationNeeded : baseline.clarificationNeeded
  };
}



