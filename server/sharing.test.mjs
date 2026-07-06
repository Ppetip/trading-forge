import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDatabase } from "./db.mjs";
import { createEdgeLabServer } from "./server.mjs";

const rules = {
  name: "Shared NQ ORB", strategyType: "opening_range_breakout", market: "Futures", symbol: "NQ",
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

async function request(base, path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function register(base, email) {
  return request(base, "/api/auth/register", {
    method: "POST", body: { email, displayName: "Sharing Test", password: "correct horse battery staple" }
  });
}

test("only an owner can publish a report and making it private revokes anonymous access", async () => {
  const db = createDatabase(":memory:");
  const server = createEdgeLabServer({ db });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = await register(base, "owner@example.com");
    const stranger = await register(base, "stranger@example.com");
    const run = await request(base, "/api/backtests/orb", { method: "POST", cookie: owner.cookie, body: { rules, candles } });
    const reportId = run.data.report.id;

    const privateRead = await request(base, `/api/public/reports/${reportId}`);
    assert.equal(privateRead.response.status, 404);

    const strangerPublish = await request(base, `/api/reports/${reportId}`, {
      method: "PATCH", cookie: stranger.cookie, body: { visibility: "public" }
    });
    assert.equal(strangerPublish.response.status, 404);

    const publish = await request(base, `/api/reports/${reportId}`, {
      method: "PATCH", cookie: owner.cookie, body: { visibility: "public" }
    });
    assert.equal(publish.response.status, 200);
    assert.equal(publish.data.report.visibility, "public");

    const shared = await request(base, `/api/public/reports/${reportId}`);
    assert.equal(shared.response.status, 200);
    assert.equal(shared.data.report.rules.name, "Shared NQ ORB");

    const revoke = await request(base, `/api/reports/${reportId}`, {
      method: "PATCH", cookie: owner.cookie, body: { visibility: "private" }
    });
    assert.equal(revoke.response.status, 200);
    const revokedRead = await request(base, `/api/public/reports/${reportId}`);
    assert.equal(revokedRead.response.status, 404);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
