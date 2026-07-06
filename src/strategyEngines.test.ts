import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_PARAMETERS, runRuleStrategy } from "./strategyEngines";
import type { Candle, StrategyRules, StrategyType } from "./types";

const baseRules: StrategyRules = {
  name: "Engine test", strategyType: "previous_day_breakout", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "6m", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true,
};

function fixtureCandles(): Candle[] {
  const candles: Candle[] = [];
  const start = new Date("2026-01-02T08:00:00");
  for (let index = 0; index < 360; index += 1) {
    const time = new Date(start);
    time.setMinutes(start.getMinutes() + index * 30);
    const wave = Math.sin(index / 7) * 8;
    const trend = index < 180 ? index * 0.06 : (360 - index) * 0.06;
    const close = 100 + trend + wave;
    candles.push({ timestamp: time.toISOString().slice(0, 19), open: close - 0.35, high: close + 1.1, low: close - 1.1, close });
  }
  return candles;
}

describe("additional strategy engines", () => {
  const types: StrategyType[] = [
    "previous_day_breakout", "previous_day_sweep", "moving_average_crossover",
    "moving_average_pullback", "rsi_reversal", "support_resistance_breakout",
  ];

  it.each(types)("executes %s with frozen uploaded-data results", (strategyType) => {
    const rules = { ...baseRules, strategyType, name: strategyType };
    const first = runRuleStrategy(rules, fixtureCandles(), DEFAULT_ENGINE_PARAMETERS);
    const second = runRuleStrategy(rules, fixtureCandles(), DEFAULT_ENGINE_PARAMETERS);
    expect(first.dataSource).toBe("uploaded");
    expect(first.rules.strategyType).toBe(strategyType);
    expect(first.trades.map((trade) => trade.resultR)).toEqual(second.trades.map((trade) => trade.resultR));
    expect(first.equity).toHaveLength(first.trades.length + 1);
    expect(first.drawdown).toHaveLength(first.trades.length + 1);
  });

  it("rejects ORB because its session-specific engine is separate", () => {
    expect(() => runRuleStrategy({ ...baseRules, strategyType: "opening_range_breakout" }, fixtureCandles())).toThrow(/not handled/i);
  });
});
