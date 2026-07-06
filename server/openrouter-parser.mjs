import { parseStrategyPrompt } from "./prompt-parser.mjs";
import { AI_MODELS, callOpenRouterJson } from "./ai-provider.mjs";

const DETERMINISTIC_KEYS = new Set(["symbol", "timeframe", "dateRange", "sessionTime", "timezone", "openingRangeMinutes", "rewardRisk"]);

export async function parseStrategyPromptWithOpenRouter(prompt, defaults = {}, {
  fetchImpl = fetch,
  model = AI_MODELS.strategyParser,
  apiKey = process.env.OPENROUTER_API_KEY
} = {}) {
  const baseline = parseStrategyPrompt(prompt, defaults);
  const generated = await callOpenRouterJson({
    model,
    fetchImpl,
    temperature: 0,
    apiKey,
    messages: [
      {
        role: "system",
        content: "You are EdgeLab's hosted strategy clarifier for a one-click historical validator. Convert the user idea into objective backtest rules with practical research defaults. Unless explicitly overridden: use the latest completed research-safe window, include every eligible Monday through Friday, interpret stated session times in America/New_York, confirm breakouts on candle close, allow one trade per day, and include fees and slippage. Never invent a weekday restriction such as Mondays-only. Return strict JSON only with keys: rules, assumptions, untestable, clarificationNeeded. Preserve supplied rule keys and value types. Never invent market data, trades, or results. Treat explanatory or promotional prose as context, not executable rules. If a later setup section gives numeric thresholds, candle conditions, stops, and exits, those objective rules override earlier phrases such as high probability, overextended, exhaustion, or reversion. Only put a condition in untestable when it is required for execution and remains undefined after reading the full prompt."
      },
      {
        role: "user",
        content: JSON.stringify({ prompt: String(prompt ?? "").slice(0, 12000), defaults, baselineRules: baseline.rules })
      }
    ]
  });

  const generatedRules = generated?.rules && typeof generated.rules === "object" ? generated.rules : {};
  const rules = Object.fromEntries(Object.entries(baseline.rules).map(([key, value]) => {
    if (DETERMINISTIC_KEYS.has(key)) return [key, value];
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
    parser: `openrouter:${model}`,
    rules,
    assumptions,
    untestable,
    clarificationNeeded: typeof generated.clarificationNeeded === "boolean" ? generated.clarificationNeeded : baseline.clarificationNeeded
  };
}

