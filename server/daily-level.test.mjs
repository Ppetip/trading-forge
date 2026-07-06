import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDatabase } from "./db.mjs";
import { runDailyLevelBacktest } from "./daily-level-engine.mjs";
import { createEdgeLabServer } from "./server.mjs";

const baseRules = {
  name: "NQ previous day", strategyType: "previous_day_breakout", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 1, direction: "long_and_short", maxTradesPerDay: 1, fees: false, slippage: false
};
const breakoutCandles = [
  { timestamp: "2026-01-05T08:00:00", open: 100, high: 101, low: 99, close: 100 },
  { timestamp: "2026-01-05T08:05:00", open: 100, high: 100.5, low: 99.5, close: 100 },
  { timestamp: "2026-01-06T08:00:00", open: 100, high: 102, low: 100, close: 101.5 },
  { timestamp: "2026-01-06T08:05:00", open: 101.5, high: 104, low: 101, close: 103.5 }
];
const sweepCandles = [
  { timestamp: "2026-01-05T08:00:00", open: 100, high: 101, low: 99, close: 100 },
  { timestamp: "2026-01-05T08:05:00", open: 100, high: 100.5, low: 99.5, close: 100 },
  { timestamp: "2026-01-06T08:00:00", open: 100.5, high: 102, low: 100, close: 100.5 },
  { timestamp: "2026-01-06T08:05:00", open: 100.5, high: 101, low: 98.5, close: 99 }
];

test("daily-level engine calculates breakout and sweep trades with stop-first execution", () => {
  const breakout = runDailyLevelBacktest(baseRules, breakoutCandles);
  assert.equal(breakout.trades.length, 1);
  assert.equal(breakout.trades[0].direction, "Long");
  assert.equal(breakout.trades[0].entry, 101);
  assert.equal(breakout.trades[0].status, "Win");
  const sweep = runDailyLevelBacktest({ ...baseRules, strategyType: "previous_day_sweep", rewardRisk: 1 }, sweepCandles);
  assert.equal(sweep.trades.length, 1);
  assert.equal(sweep.trades[0].direction, "Short");
  assert.equal(sweep.trades[0].status, "Win");
});

async function request(base, path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("daily-level API stores immutable reports and reuses exact cached results", async () => {
  const db = createDatabase(":memory:");
  const server = createEdgeLabServer({ db });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registration = await request(base, "/api/auth/register", {
      method: "POST", body: { email: "daily@example.com", displayName: "Daily Engine", password: "correct horse battery staple" }
    });
    const input = { rules: baseRules, candles: breakoutCandles };
    const first = await request(base, "/api/backtests/daily-level", { method: "POST", cookie: registration.cookie, body: input });
    assert.equal(first.response.status, 201);
    assert.equal(first.data.report.engineVersion, "daily-level-1.0.0");
    assert.equal(first.data.report.result.trades[0].status, "Win");
    const cached = await request(base, "/api/backtests/daily-level", { method: "POST", cookie: registration.cookie, body: input });
    assert.equal(cached.response.status, 200);
    assert.equal(cached.data.cached, true);
    assert.equal(cached.data.report.id, first.data.report.id);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
