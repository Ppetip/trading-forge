import test from "node:test";
import assert from "node:assert/strict";
import { reportCacheKey } from "./cache.mjs";
import { ORB_ENGINE_VERSION, runOrbBacktest } from "./orb-engine.mjs";

const baseRules = {
  name: "Synthetic ORB",
  strategyType: "opening_range_breakout",
  symbol: "NQ",
  market: "Futures",
  timeframe: "5m",
  dateRange: "1y",
  sessionTime: "09:30",
  timezone: "America/New_York",
  openingRangeMinutes: 5,
  entryConfirmation: "wick_break",
  rewardRisk: 3,
  direction: "long_and_short",
  maxTradesPerDay: 1,
  fees: false,
  slippage: false,
  intrabarConflictMode: "stop_first"
};

const provenance = {
  provider: "synthetic",
  requestedSymbol: "NQ",
  resolvedSymbol: "NQ",
  interval: "5m",
  start: "2026-07-01",
  end: "2026-07-01"
};

function candle(time, open, high, low, close, date = "2026-07-01") {
  return { timestamp: `${date}T${time}:00`, open, high, low, close };
}

function run(candles, rules = {}) {
  return runOrbBacktest({ ...baseRules, ...rules }, candles, { cacheKey: "synthetic-cache", dataProvenance: provenance });
}

test("ORB known answer: no breakout means zero trades", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 100, 100.8, 99.2, 100.1),
    candle("09:40", 100.1, 100.9, 99.4, 100.2)
  ]);
  assert.equal(result.trades.length, 0);
  assert.equal(result.audit.tradeCount, 0);
});

test("ORB known answer: long breakout hits 3R target", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 101, 101.5, 100.2, 101.2),
    candle("09:40", 101.2, 107.1, 101, 107)
  ]);
  assert.equal(result.trades[0].direction, "Long");
  assert.equal(result.trades[0].grossR, 3);
  assert.equal(result.totalR, 3);
});

test("ORB known answer: long breakout hits stop for -1R", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 101, 101.5, 99.2, 101.2),
    candle("09:40", 101.2, 102, 98.8, 99)
  ]);
  assert.equal(result.trades[0].direction, "Long");
  assert.equal(result.trades[0].grossR, -1);
  assert.equal(result.totalR, -1);
});

test("ORB known answer: short breakout hits 3R target", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 99, 99.8, 98.5, 98.8),
    candle("09:40", 98.8, 99, 92.9, 93)
  ]);
  assert.equal(result.trades[0].direction, "Short");
  assert.equal(result.trades[0].grossR, 3);
  assert.equal(result.totalR, 3);
});

test("ORB known answer: short breakout hits stop for -1R", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 99, 100.8, 98.5, 98.8),
    candle("09:40", 98.8, 101.2, 98, 101)
  ]);
  assert.equal(result.trades[0].direction, "Short");
  assert.equal(result.trades[0].grossR, -1);
  assert.equal(result.totalR, -1);
});

test("ORB known answer: both long and short break on same day, first chronological breakout wins", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 99, 100.8, 98.5, 98.8),
    candle("09:40", 101, 102, 100, 101.5)
  ]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].direction, "Short");
  assert.equal(result.trades[0].time, "09:35");
});

test("ORB known answer: same candle stop/target conflict is counted as ambiguous", () => {
  const result = run([
    candle("09:30", 100, 101, 99, 100),
    candle("09:35", 101, 107.2, 98.8, 103)
  ]);
  assert.equal(result.trades[0].ambiguous, true);
  assert.equal(result.trades[0].exitReason, "stop_first_conflict");
  assert.equal(result.audit.ambiguousTrades, 1);
});

test("ORB known answer: timezone conversion keeps 9:30 New York open correct", () => {
  const result = run([
    { timestamp: "2026-07-01T13:30:00Z", open: 100, high: 101, low: 99, close: 100 },
    { timestamp: "2026-07-01T13:35:00Z", open: 101, high: 107.1, low: 100.5, close: 107 }
  ]);
  assert.equal(result.trades[0].time, "09:35");
  assert.equal(result.audit.timezone, "America/New_York");
});

test("ORB cache key changes when ORB start time changes", () => {
  const first = reportCacheKey({ rules: { ...baseRules, sessionTime: "09:30" }, dataFingerprint: "same", engineVersion: ORB_ENGINE_VERSION });
  const second = reportCacheKey({ rules: { ...baseRules, sessionTime: "08:00" }, dataFingerprint: "same", engineVersion: ORB_ENGINE_VERSION });
  assert.notEqual(first, second);
});

test("ORB cache key changes when rewardRisk changes", () => {
  const first = reportCacheKey({ rules: { ...baseRules, rewardRisk: 2 }, dataFingerprint: "same", engineVersion: ORB_ENGINE_VERSION });
  const second = reportCacheKey({ rules: { ...baseRules, rewardRisk: 3 }, dataFingerprint: "same", engineVersion: ORB_ENGINE_VERSION });
  assert.notEqual(first, second);
});
