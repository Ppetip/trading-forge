import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDatabase } from "./db.mjs";
import { createEdgeLabServer } from "./server.mjs";

async function request(base, path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("transcript extraction is paid, stored per user, and exposes assumptions", async () => {
  const db = createDatabase(":memory:");
  const server = createEdgeLabServer({ db });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registration = await request(base, "/api/auth/register", {
      method: "POST", body: { email: "transcript@example.com", displayName: "Transcript Test", password: "correct horse battery staple" }
    });
    const cookie = registration.cookie;
    const input = {
      title: "ORB video notes", sourceType: "youtube_transcript", sourceUrl: "https://youtube.com/watch?v=test",
      content: "Trade the NQ opening range breakout at 8 AM. Go long or short after the first range breaks and target 1:3 risk reward."
    };
    const freeAttempt = await request(base, "/api/transcripts", { method: "POST", cookie, body: input });
    assert.equal(freeAttempt.response.status, 402);
    assert.equal(freeAttempt.data.error.code, "PLAN_LIMIT_REACHED");

    await request(base, "/api/billing/trial", { method: "POST", cookie });
    const extracted = await request(base, "/api/transcripts", { method: "POST", cookie, body: input });
    assert.equal(extracted.response.status, 201);
    assert.equal(extracted.data.source.status, "extracted");
    assert.equal(extracted.data.source.extraction.rules.strategyType, "opening_range_breakout");
    assert.ok(extracted.data.source.extraction.assumptions.length > 0);
    assert.match(extracted.data.source.extraction.warning, /Review every rule/);

    const listed = await request(base, "/api/transcripts", { cookie });
    assert.equal(listed.data.sources.length, 1);
    assert.equal(listed.data.sources[0].title, "ORB video notes");
    const account = await request(base, "/api/account", { cookie });
    assert.equal(account.data.account.usage.used.transcriptExtractions, 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
