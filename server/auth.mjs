import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw new Error("Password must contain 10 to 200 characters.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded).split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

export function createSession(db, userId, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, tokenHash(token), expires.toISOString(), now.toISOString(), now.toISOString());
  return { token, expires };
}

export function readSession(db, token, now = new Date()) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, s.id AS session_id, s.expires_at,
           COALESCE(sub.plan, 'free') AS plan, COALESCE(sub.status, 'active') AS subscription_status,
           sub.trial_ends_at, sub.current_period_ends_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN subscriptions sub ON sub.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), now.toISOString());
  if (!row) return null;
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), row.session_id);
  return row;
}

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((item) => item.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
}

export function sessionCookie(token, expires, secure = false) {
  return `edgelab_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
}

export const clearSessionCookie = (secure = false) =>
  `edgelab_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
