import { createHash } from "node:crypto";

const buckets = new Map();
const policies = {
  auth: { limit: 10, windowMs: 60_000 },
  backtest: { limit: 30, windowMs: 60_000 },
  ai: { limit: 20, windowMs: 60_000 },
};

function clientKey(request) {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || request.socket?.remoteAddress || "unknown";
}

export function enforceRateLimit(request, group, now = Date.now()) {
  const policy = policies[group];
  if (!policy) return;
  const key = `${group}:${clientKey(request)}`, previous = buckets.get(key);
  const entry = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + policy.windowMs } : previous;
  entry.count += 1; buckets.set(key, entry);
  if (entry.count > policy.limit) {
    const error = new Error("Too many requests. Please wait and try again.");
    error.status = 429; error.code = "RATE_LIMITED";
    error.details = { retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    throw error;
  }
}

export function enforceSameOrigin(request) {
  const method = request.method ?? "GET";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  if (!String(request.headers.cookie ?? "").includes("edgelab_session=")) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  if (new URL(origin).host !== host) {
    const error = new Error("Cross-origin write rejected."); error.status = 403; error.code = "ORIGIN_REJECTED"; throw error;
  }
}

const identityHash = (email) => createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
export function assertLoginAllowed(db, email, at = new Date()) {
  const row = db.prepare("SELECT * FROM login_attempts WHERE identity_hash = ?").get(identityHash(email));
  if (row?.blocked_until && new Date(row.blocked_until) > at) {
    const error = new Error("Too many failed attempts. Try again later."); error.status = 429; error.code = "LOGIN_COOLDOWN";
    error.details = { retryAfterSeconds: Math.ceil((new Date(row.blocked_until) - at) / 1000) }; throw error;
  }
}
export function recordLoginFailure(db, email, at = new Date()) {
  const key = identityHash(email), row = db.prepare("SELECT * FROM login_attempts WHERE identity_hash = ?").get(key);
  const windowExpired = !row || at - new Date(row.window_started_at) > 15 * 60_000;
  const count = windowExpired ? 1 : Number(row.failed_count) + 1;
  const blocked = count >= 5 ? new Date(at.getTime() + 15 * 60_000).toISOString() : null;
  db.prepare("INSERT INTO login_attempts (identity_hash, failed_count, window_started_at, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(identity_hash) DO UPDATE SET failed_count=excluded.failed_count, window_started_at=excluded.window_started_at, blocked_until=excluded.blocked_until")
    .run(key, count, windowExpired ? at.toISOString() : row.window_started_at, blocked);
}
export function clearLoginFailures(db, email) { db.prepare("DELETE FROM login_attempts WHERE identity_hash = ?").run(identityHash(email)); }
export function resetRateLimitsForTests() { buckets.clear(); }