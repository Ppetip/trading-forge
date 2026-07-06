import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./db.mjs";
import { routeMarketData, estimateDataCost } from "./market-data-router.mjs";

const rules = { symbol: "NQ", market: "Futures", timeframe: "1d", dateRange: "1y", timezone: "America/New_York" };
function account(db, plan = "free") {
  const id = `user-${plan}-${crypto.randomUUID()}`, timestamp = new Date().toISOString();
  db.prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, `${id}@example.com`, "x", plan, timestamp, timestamp);
  db.prepare("INSERT INTO subscriptions (user_id,plan,status,updated_at) VALUES (?,?,?,?)").run(id, plan, "active", timestamp);
  return db.prepare("SELECT u.*, s.plan, s.status AS subscription_status, s.trial_ends_at, s.current_period_ends_at FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE u.id = ?").get(id);
}

test("uploaded candles bypass providers and expose stable provenance", async () => {
  const db = createDatabase(":memory:"), user = account(db);
  const candles = [{ timestamp: "2026-01-01T00:00:00", open: 1, high: 2, low: 1, close: 2 }];
  const routed = await routeMarketData({ db, account: user, rules, candles });
  assert.deepEqual(routed.candles, candles); assert.equal(routed.dataProvenance.provider, "uploaded");
  assert.equal(routed.dataProvenance.grade, "uploaded"); assert.equal(routed.dataProvenance.providerCalls, 0);
  assert.deepEqual(Object.keys(routed.dataProvenance), ["provider", "grade", "requestedSymbol", "resolvedSymbol", "interval", "start", "end", "proxy", "dataset", "adjusted", "continuous", "cacheHit", "providerCalls", "costScore"]);
  db.close();
});

test("free futures requests use a research-grade ETF proxy", async () => {
  const db = createDatabase(":memory:"), user = account(db); let requestedUrl = "";
  const routed = await routeMarketData({ db, account: user, rules, now: new Date(`2026-07-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}T00:00:00Z`),
    fetchImpl: async (url) => { requestedUrl = String(url); return { ok: true, json: async () => ({ chart: { result: [{ meta: { exchangeName: "NMS", currency: "USD" },
      timestamp: [1751328000], indicators: { quote: [{ open: [500], high: [505], low: [499], close: [504] }], adjclose: [{ adjclose: [503] }] } }] } }) }; } });
  if (!routed.dataProvenance.cacheHit) assert.match(requestedUrl, /QQQ/);
  assert.equal(routed.dataProvenance.provider, "yahoo");
  assert.equal(routed.dataProvenance.requestedSymbol, "NQ"); assert.equal(routed.dataProvenance.resolvedSymbol, "QQQ");
  assert.equal(routed.dataProvenance.proxy, true); assert.equal(routed.dataProvenance.grade, "research");
  db.close();
});

test("free accounts cannot explicitly request premium data", async () => {
  const db = createDatabase(":memory:"), user = account(db);
  await assert.rejects(routeMarketData({ db, account: user, rules, preferredProvider: "databento" }),
    (error) => error.code === "PREMIUM_DATA_REQUIRED" && error.status === 402 && error.details.proxySymbol === "QQQ");
  db.close();
});

test("free 30-day intraday requests fetch only the requested safe window", async () => {
  const db = createDatabase(":memory:"), user = account(db); let requestedUrl = "";
  const routed = await routeMarketData({ db, account: user, rules: { ...rules, symbol: `TEST${Math.floor(Math.random() * 1e9)}`, timeframe: "15m", dateRange: "30d" },
    now: new Date("2026-07-06T12:00:00Z"),
    fetchImpl: async (url) => { requestedUrl = String(url); return { ok: true, json: async () => ({ chart: { result: [{ meta: { exchangeName: "NYQ", currency: "USD" },
      timestamp: [1751328000], indicators: { quote: [{ open: [500], high: [505], low: [499], close: [504] }], adjclose: [{ adjclose: [503] }] } }] } }) }; } });
  const query = new URL(requestedUrl), spanDays = (Number(query.searchParams.get("period2")) - Number(query.searchParams.get("period1"))) / 86400;
  assert.equal(routed.dataProvenance.provider, "yahoo");
  assert.equal(routed.dataProvenance.interval, "15m");
  assert.equal(spanDays, 30);
  db.close();
});
test("free long intraday requests explain the upgrade instead of silently clipping", async () => {
  const db = createDatabase(":memory:"), user = account(db);
  await assert.rejects(routeMarketData({ db, account: user, rules: { ...rules, timeframe: "5m", dateRange: "3y" } }),
    (error) => error.code === "PREMIUM_INTRADAY_REQUIRED" && error.status === 402 && error.details.researchLimitDays === 59 && /Upgrade to Pro/.test(error.message));
  db.close();
});

test("unrealistic windows are rejected with explicit options", async () => {
  const db = createDatabase(":memory:"), user = account(db, "pro");
  await assert.rejects(routeMarketData({ db, account: user, rules: { ...rules, timeframe: "1d", dateRange: "10y" } }),
    (error) => error.code === "UNREALISTIC_BACKTEST_WINDOW" && error.status === 422 && error.details.maxYears === 5);
  db.close();
});

test("admin data controls can disable research provider fetches", async () => {
  const db = createDatabase(":memory:"), user = account(db, "free");
  db.prepare("INSERT INTO app_settings (key,value_json,updated_at) VALUES ('data_controls',?,?)")
    .run(JSON.stringify({ disableYahoo: true }), new Date().toISOString());
  await assert.rejects(routeMarketData({ db, account: user, rules }),
    (error) => error.code === "DATA_CONTROL_YAHOO_DISABLED" && error.status === 503 && error.details.provider === "yahoo");
  db.close();
});

test("admin data controls can force daily candles", async () => {
  const db = createDatabase(":memory:"), user = account(db, "free");
  db.prepare("INSERT INTO app_settings (key,value_json,updated_at) VALUES ('data_controls',?,?)")
    .run(JSON.stringify({ forceDailyCandles: true }), new Date().toISOString());
  await assert.rejects(routeMarketData({ db, account: user, rules: { ...rules, timeframe: "5m", dateRange: "30d" } }),
    (error) => error.code === "DATA_CONTROL_DAILY_ONLY" && error.status === 503 && error.details.allowedTimeframe === "1d");
  db.close();
});

test("data cost score distinguishes cache and large premium pulls", () => {
  assert.equal(estimateDataCost({ provider: "databento", cacheHit: true, estimatedCandles: 999999 }), "low");
  assert.equal(estimateDataCost({ provider: "databento", estimatedCandles: 150000, providerCalls: 12 }), "high");
  assert.equal(estimateDataCost({ provider: "yahoo", estimatedCandles: 300 }), "low");
});
