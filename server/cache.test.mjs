import test from "node:test";
import assert from "node:assert/strict";
import { candleFingerprint } from "./cache.mjs";

test("market-data fingerprint changes when any candle changes", () => {
  const candles = [
    { timestamp: "2026-01-01T08:00:00", open: 100, high: 101, low: 99, close: 100 },
    { timestamp: "2026-01-01T08:05:00", open: 100, high: 102, low: 99, close: 101 },
    { timestamp: "2026-01-01T08:10:00", open: 101, high: 103, low: 100, close: 102 }
  ];
  const changedMiddle = candles.map((candle, index) => index === 1 ? { ...candle, high: 102.25 } : candle);
  assert.notEqual(candleFingerprint(candles), candleFingerprint(changedMiddle));
  assert.equal(candleFingerprint(candles), candleFingerprint(structuredClone(candles)));
});
