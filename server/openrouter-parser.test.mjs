import test from "node:test";
import assert from "node:assert/strict";
import { parseStrategyPromptWithOpenRouter } from "./openrouter-parser.mjs";

function openRouterResponse(content, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status, headers: { "content-type": "application/json" } });
}

test("explicit prompt symbol and timing override stale defaults and model output", async () => {
  const fetchImpl = async () => openRouterResponse({
    rules: { symbol: "NQ", timeframe: "5m", dateRange: "1y", sessionTime: "08:00", openingRangeMinutes: 30, rewardRisk: 3 },
    assumptions: [],
    untestable: [],
    clarificationNeeded: false
  });
  const parsed = await parseStrategyPromptWithOpenRouter(
    "Test SPY at 9:30 AM using 15-minute candles, a 15-minute opening range, and 1:2 risk reward.",
    { symbol: "NQ", sessionTime: "08:00", timezone: "America/New_York" },
    { fetchImpl, model: "test/parser", apiKey: "test-key" }
  );
  assert.equal(parsed.parser, "openrouter:test/parser");
  assert.equal(parsed.rules.symbol, "SPY");
  assert.equal(parsed.rules.timeframe, "15m");
  assert.equal(parsed.rules.sessionTime, "09:30");
  assert.equal(parsed.rules.openingRangeMinutes, 15);
  assert.equal(parsed.rules.rewardRisk, 2);
  assert.equal(parsed.rules.dateRange, "30d");
});

test("free-safe parser defaults use the research intraday window", async () => {
  const fetchImpl = async () => openRouterResponse({ rules: {}, assumptions: [], untestable: [], clarificationNeeded: false });
  const parsed = await parseStrategyPromptWithOpenRouter("Test an opening range breakout on SPY.", {}, { fetchImpl, model: "test/parser", apiKey: "test-key" });
  assert.equal(parsed.rules.symbol, "SPY");
  assert.equal(parsed.rules.timeframe, "15m");
  assert.equal(parsed.rules.dateRange, "30d");
  assert.equal(parsed.rules.sessionTime, "09:30");
  assert.equal(parsed.rules.rewardRisk, 2);
});

