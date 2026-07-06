import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./db.mjs";
import { assertLoginAllowed, clearLoginFailures, enforceRateLimit, enforceSameOrigin, recordLoginFailure, resetRateLimitsForTests } from "./security.mjs";
import { getDataControls, requireAdmin, updateDataControls } from "./admin-controls.mjs";

const request = (overrides = {}) => ({ method: "POST", headers: {}, socket: { remoteAddress: "127.0.0.1" }, ...overrides });
test("same-origin cookie writes reject foreign origins", () => {
  assert.throws(() => enforceSameOrigin(request({ headers: { cookie: "edgelab_session=x", host: "localhost:8787", origin: "https://evil.example" } })), (error) => error.code === "ORIGIN_REJECTED");
  assert.doesNotThrow(() => enforceSameOrigin(request({ headers: { cookie: "edgelab_session=x", host: "localhost:8787", origin: "http://localhost:8787" } })));
});
test("local Vite proxy cookie writes are allowed outside production", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  assert.doesNotThrow(() => enforceSameOrigin(request({ headers: { cookie: "edgelab_session=x", host: "127.0.0.1:8787", origin: "http://localhost:5173" } })));
  if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
});
test("production cookie writes still reject mismatched loopback ports unless configured", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.throws(() => enforceSameOrigin(request({ headers: { cookie: "edgelab_session=x", host: "127.0.0.1:8787", origin: "http://localhost:5173" } })), (error) => error.code === "ORIGIN_REJECTED");
  if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
});
test("rate limits sensitive route groups", () => { resetRateLimitsForTests(); for (let i=0;i<10;i++) enforceRateLimit(request(), "auth", 1000); assert.throws(() => enforceRateLimit(request(), "auth", 1000), (error) => error.code === "RATE_LIMITED"); });
test("five login failures activate a cooldown without storing the email", async () => {
  const db = createDatabase(":memory:");
  for (let i = 0; i < 5; i += 1) await recordLoginFailure(db, "private@example.com", new Date("2026-01-01T00:00:00Z"));
  await assert.rejects(() => assertLoginAllowed(db, "private@example.com", new Date("2026-01-01T00:01:00Z")), (error) => error.code === "LOGIN_COOLDOWN");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM login_attempts WHERE identity_hash='private@example.com'").get().total, 0);
  await clearLoginFailures(db, "private@example.com");
  await assert.doesNotReject(() => assertLoginAllowed(db, "private@example.com"));
  db.close();
});
test("only admins can change audited data kill switches", async () => {
  const db = createDatabase(":memory:"), now = new Date().toISOString();
  db.prepare("INSERT INTO users(id,email,password_hash,display_name,role,created_at,updated_at) VALUES('a','a@x.test','x','Admin','admin',?,?),('u','u@x.test','x','User','user',?,?)").run(now, now, now, now);
  assert.throws(() => requireAdmin({ id: "u", role: "user" }), (error) => error.code === "FORBIDDEN");
  const controls = await updateDataControls(db, { id: "a", role: "admin" }, { disableDatabento: true });
  assert.equal(controls.disableDatabento, true);
  assert.equal(controls.cachedDatabentoOnly, true);
  assert.equal((await getDataControls(db)).disableDatabento, true);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM usage_events WHERE event_type='admin_data_controls_changed'").get().total, 1);
  db.close();
});
