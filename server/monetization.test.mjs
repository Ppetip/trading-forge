import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { createDatabase } from "./db.mjs";
import { createEdgeLabServer } from "./server.mjs";

const rules = {
  name: "NQ ORB", strategyType: "opening_range_breakout", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true
};
const candles = [
  { timestamp: "2026-01-05T08:00:00", open: 100, high: 101, low: 99, close: 100 },
  { timestamp: "2026-01-05T08:05:00", open: 100, high: 102, low: 99.5, close: 101 },
  { timestamp: "2026-01-05T08:10:00", open: 101, high: 103, low: 100, close: 102 },
  { timestamp: "2026-01-05T08:15:00", open: 102, high: 104, low: 102, close: 104 },
  { timestamp: "2026-01-05T08:20:00", open: 104, high: 112, low: 103.5, close: 111 }
];

async function request(base, path, { method = "GET", body, cookie, headers = {} } = {}) {
  const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(raw ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw
  });
  return {
    response,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

test("trial unlocks Pine exports and signed billing events update the plan", async () => {
  const db = createDatabase(":memory:");
  const secret = "test-webhook-secret";
  const server = createEdgeLabServer({ db, billingSecret: secret });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registration = await request(base, "/api/auth/register", {
      method: "POST",
      body: { email: "billing@example.com", displayName: "Billing Test", password: "correct horse battery staple" }
    });
    const cookie = registration.cookie;
    const run = await request(base, "/api/backtests/orb", { method: "POST", cookie, body: { rules, candles } });
    const reportId = run.data.report.id;

    const freeExport = await request(base, `/api/reports/${reportId}/pine`, { method: "POST", cookie });
    assert.equal(freeExport.response.status, 402);
    assert.equal(freeExport.data.error.code, "PLAN_LIMIT_REACHED");

    const trial = await request(base, "/api/billing/trial", { method: "POST", cookie });
    assert.equal(trial.response.status, 201);
    assert.equal(trial.data.trial.plan, "trial");

    const exported = await request(base, `/api/reports/${reportId}/pine`, { method: "POST", cookie });
    assert.equal(exported.response.status, 200);
    assert.match(exported.data.script, /strategy\("NQ ORB"/);
    assert.match(exported.data.filename, /\.pine$/);

    const secondTrial = await request(base, "/api/billing/trial", { method: "POST", cookie });
    assert.equal(secondTrial.response.status, 409);
    assert.equal(secondTrial.data.error.code, "TRIAL_UNAVAILABLE");

    const userId = db.prepare("SELECT id FROM users WHERE email = ?").get("billing@example.com").id;
    const event = JSON.stringify({
      type: "subscription.updated",
      data: {
        userId, plan: "pro", status: "active", customerId: "cus_test",
        subscriptionId: "sub_test", currentPeriodEndsAt: "2026-08-01T00:00:00.000Z"
      }
    });
    const signature = createHmac("sha256", secret).update(event).digest("hex");
    const webhook = await request(base, "/api/billing/webhook", {
      method: "POST", body: event, headers: { "x-edgelab-signature": signature }
    });
    assert.equal(webhook.response.status, 200);
    assert.equal(webhook.data.plan, "pro");

    const account = await request(base, "/api/account", { cookie });
    assert.equal(account.data.account.plan, "pro");
    assert.equal(account.data.account.usage.limits.pineExports, 500);

    const invalid = await request(base, "/api/billing/webhook", {
      method: "POST", body: event, headers: { "x-edgelab-signature": "invalid" }
    });
    assert.equal(invalid.response.status, 401);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
