import { describe, expect, it } from "vitest";
import { runRuleStrategy } from "./strategyEngines";
import type { Candle, StrategyRules } from "./types";

describe("saved run snapshot integrity", () => {
  it("embeds edited engine parameters and enforces the daily trade cap", () => {
    const rules: StrategyRules = {
      name: "Snapshot", strategyType: "support_resistance_breakout", market: "Futures", symbol: "ES",
      timeframe: "5m", dateRange: "6m", sessionTime: "08:00", timezone: "America/New_York",
      openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
      rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true,
    };
    const parameters = { fastMa: 7, slowMa: 30, rsiPeriod: 10, rsiOversold: 25, rsiOverbought: 75, lookback: 8, stopLookback: 3 };
    const candles: Candle[] = Array.from({ length: 80 }, (_, index) => {
      const close = 100 + index * 0.5 + Math.sin(index) * 2;
      return { timestamp: `2026-03-02T${String(8 + Math.floor(index / 12)).padStart(2, "0")}:${String(index % 12 * 5).padStart(2, "0")}:00`, open: close - 0.2, high: close + 1, low: close - 1, close };
    });
    const result = runRuleStrategy(rules, candles, parameters);
    expect(result.engineParameters).toEqual(parameters);
    expect(result.trades.length).toBeLessThanOrEqual(1);
    expect(JSON.parse(JSON.stringify(result)).engineParameters.lookback).toBe(8);
  });
});
