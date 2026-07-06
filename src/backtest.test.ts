import { describe, expect, it } from "vitest";
import { parseCandleCsv, runDemoBacktest, runOrbBacktest } from "./backtest";
import type { StrategyRules } from "./types";

const rules: StrategyRules = {
  name: "Test ORB", strategyType: "opening_range_breakout", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: false, slippage: false,
};

describe("backtest engine", () => {
  it("produces repeatable demo results", () => {
    const first = runDemoBacktest(rules);
    const second = runDemoBacktest(rules);
    expect(first.trades.map((trade) => trade.resultR)).toEqual(second.trades.map((trade) => trade.resultR));
    expect(first.totalR).toBe(second.totalR);
  });

  it("parses candle CSV and executes an ORB win", () => {
    const candles = parseCandleCsv(`timestamp,open,high,low,close
2026-01-02T08:00:00,100,101,99,100
2026-01-02T08:05:00,100,102,99.5,101
2026-01-02T08:10:00,101,103,100,102
2026-01-02T08:15:00,102,104,102,104
2026-01-02T08:20:00,104,112,103.5,111`);
    const result = runOrbBacktest(rules, candles);
    expect(result.dataSource).toBe("uploaded");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].status).toBe("Win");
    expect(result.totalR).toBe(2);
  });

  it("rejects malformed candle data", () => {
    expect(() => parseCandleCsv("date,price\n2026-01-01,100")).toThrow(/headers/i);
  });
});
