import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDatabase } from "./db.mjs";
import { createEdgeLabServer } from "./server.mjs";
import { parseStrategyPrompt } from "./prompt-parser.mjs";
import { reportCacheKey, stableStringify } from "./cache.mjs";

function fixtureCandles(offset = 0) {
  const rows = [];
  for (let day = 0; day < 5; day += 1) {
    const date = `2026-01-${String(day + 5).padStart(2, "0")}`;
    const prices = [
      [100, 101, 99, 100], [100, 102, 99.5, 101], [101, 103, 100, 102],
      [102, 104, 102, 104], [104, 112 + offset + day, 103.5, 111 + offset + day]
    ];
    prices.forEach(([open, high, low, close], index) => rows.push({
      timestamp: `${date}T${index === 0 ? "08:00" : `08:${String(index * 5).padStart(2, "0")}`}:00`,
      open: open + offset, high: high + offset, low: low + offset, close: close + offset
    }));
  }
  return rows;
}

const rules = {
  name: "NQ ORB", strategyType: "opening_range_breakout", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true
};

async function withApi(callback) {
  const db = createDatabase(":memory:");
  const server = createEdgeLabServer({ db });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback({ db, base });
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
}

async function request(base, path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function register(base, email = "trader@example.com") {
  const result = await request(base, "/api/auth/register", {
    method: "POST",
    body: { email, displayName: "Test Trader", password: "correct horse battery staple" }
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.cookie);
  return result.cookie;
}

test("cache keys are stable across object key order", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
  assert.equal(
    reportCacheKey({ rules: { b: 2, a: 1 }, dataFingerprint: "x", engineVersion: "1" }),
    reportCacheKey({ rules: { a: 1, b: 2 }, dataFingerprint: "x", engineVersion: "1" })
  );
});

test("prompt parser exposes assumptions without inventing results", () => {
  const parsed = parseStrategyPrompt("Test three years of the 8 AM opening range breakout on NQ with 1:3 risk reward.");
  assert.equal(parsed.rules.symbol, "NQ");
  assert.equal(parsed.rules.sessionTime, "08:00");
  assert.equal(parsed.rules.rewardRisk, 3);
  assert.equal(parsed.rules.strategyType, "opening_range_breakout");
  assert.equal("results" in parsed, false);
});

test("account, versioning, server backtest, cache, reports, and limits work together", async () => {
  await withApi(async ({ db, base }) => {
    const health = await request(base, "/api/health");
    assert.equal(health.response.status, 200);
    const cookie = await register(base);

    const account = await request(base, "/api/account", { cookie });
    assert.equal(account.data.account.plan, "free");
    assert.equal(account.data.account.usage.limits.backtests, 5);

    const parsed = await request(base, "/api/ai/parse-rules", {
      method: "POST", cookie, body: { prompt: "Run a 15 minute opening range breakout on ES at 9:30 AM using 1:2." }
    });
    assert.equal(parsed.response.status, 200);
    assert.equal(parsed.data.rules.symbol, "ES");

    const created = await request(base, "/api/strategies", {
      method: "POST", cookie, body: { name: "ORB Research", rules, prompt: "Initial ORB" }
    });
    assert.equal(created.response.status, 201);
    const strategyId = created.data.strategy.id;

    const version = await request(base, `/api/strategies/${strategyId}/versions`, {
      method: "POST", cookie, body: { rules: { ...rules, rewardRisk: 3 }, prompt: "Try 1:3", changeSummary: "Raised target" }
    });
    assert.equal(version.data.version.versionNumber, 2);

    const detail = await request(base, `/api/strategies/${strategyId}`, { cookie });
    assert.equal(detail.data.versions.length, 2);
    assert.equal(detail.data.versions[0].parentVersionId, detail.data.versions[1].id);

    const first = await request(base, "/api/backtests/orb", {
      method: "POST", cookie, body: { rules, candles: fixtureCandles(), strategyVersionId: version.data.version.id }
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.data.cached, false);
    assert.equal(first.data.report.result.trades.length, 5);

    const cached = await request(base, "/api/backtests/orb", {
      method: "POST", cookie, body: { candles: fixtureCandles(), rules }
    });
    assert.equal(cached.response.status, 200);
    assert.equal(cached.data.cached, true);
    assert.equal(cached.data.report.id, first.data.report.id);

    const reports = await request(base, "/api/reports", { cookie });
    assert.equal(reports.data.reports.length, 1);
    const report = await request(base, `/api/reports/${first.data.report.id}`, { cookie });
    assert.equal(report.data.report.rules.rewardRisk, 2);

    for (let index = 1; index <= 2; index += 1) {
      const run = await request(base, "/api/backtests/orb", {
        method: "POST", cookie, body: { rules: { ...rules, sessionTime: `0${8 + index}:00` }, candles: fixtureCandles(index) }
      });
      assert.equal(run.response.status, 201);
    }
    const limited = await request(base, "/api/backtests/orb", {
      method: "POST", cookie, body: { rules: { ...rules, sessionTime: "11:00" }, candles: fixtureCandles(4) }
    });
    assert.equal(limited.response.status, 402);
    assert.equal(limited.data.error.code, "PLAN_LIMIT_REACHED");

    const userId = db.prepare("SELECT id FROM users LIMIT 1").get().id;
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userId);
    const metrics = await request(base, "/api/admin/metrics", { cookie });
    assert.equal(metrics.response.status, 200);
    assert.equal(metrics.data.metrics.totalUsers, 1);
    assert.equal(metrics.data.metrics.strategies, 1);
    assert.equal(metrics.data.metrics.reports, 3);
  });
});

test("authentication rejects duplicates and invalid credentials", async () => {
  await withApi(async ({ base }) => {
    await register(base);
    const duplicate = await request(base, "/api/auth/register", {
      method: "POST", body: { email: "TRADER@example.com", displayName: "Other", password: "another secure password" }
    });
    assert.equal(duplicate.response.status, 400);
    assert.equal(duplicate.data.error.code, "EMAIL_EXISTS");
    const invalid = await request(base, "/api/auth/login", {
      method: "POST", body: { email: "trader@example.com", password: "wrong password" }
    });
    assert.equal(invalid.response.status, 401);
  });
});
