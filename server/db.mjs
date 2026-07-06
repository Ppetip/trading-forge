import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_PATH = resolve("data", "edgelab.sqlite");

export function createDatabase(filename = process.env.EDGELAB_DB_PATH || DEFAULT_PATH) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'trial', 'pro', 'power')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
      trial_ends_at TEXT,
      current_period_ends_at TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      strategy_type TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_versions (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      parent_version_id TEXT REFERENCES strategy_versions(id),
      prompt TEXT,
      rules_json TEXT NOT NULL,
      engine_parameters_json TEXT,
      change_summary TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(strategy_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      strategy_version_id TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL,
      cache_key TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      data_fingerprint TEXT NOT NULL,
      rules_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
      created_at TEXT NOT NULL,
      UNIQUE(user_id, cache_key)
    );

    CREATE INDEX IF NOT EXISTS reports_cache_key_idx ON reports(cache_key);
    CREATE INDEX IF NOT EXISTS reports_user_created_idx ON reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS versions_strategy_idx ON strategy_versions(strategy_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS usage_user_type_date_idx ON usage_events(user_id, event_type, created_at);

    CREATE TABLE IF NOT EXISTS transcript_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_url TEXT,
      title TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      extracted_rules_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      identity_hash TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT
    );
  `);
  migrateSubscriptionsPlanCheck(db);
  const reportColumns = db.prepare("PRAGMA table_info(reports)").all();
  if (!reportColumns.some((column) => column.name === "data_provenance_json")) db.exec("ALTER TABLE reports ADD COLUMN data_provenance_json TEXT");
  bootstrapAdmin(db);
  return db;
}

function migrateSubscriptionsPlanCheck(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'").get();
  if (!row?.sql || (row.sql.includes("'starter'") && row.sql.includes("'power'"))) return;
  const legacyName = `subscriptions_legacy_${Date.now()}`;
  try {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      ALTER TABLE subscriptions RENAME TO ${legacyName};
      CREATE TABLE subscriptions (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'trial', 'pro', 'power')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
        trial_ends_at TEXT,
        current_period_ends_at TEXT,
        provider_customer_id TEXT,
        provider_subscription_id TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO subscriptions (user_id, plan, status, trial_ends_at, current_period_ends_at, provider_customer_id, provider_subscription_id, updated_at)
      SELECT user_id, plan, status, trial_ends_at, current_period_ends_at, provider_customer_id, provider_subscription_id, updated_at FROM ${legacyName};
      DROP TABLE ${legacyName};
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  } catch (error) {
    try { db.exec("ROLLBACK; PRAGMA foreign_keys = ON;"); } catch {}
    throw error;
  }
}

function bootstrapAdmin(db) {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) return;
  const configured = String(process.env.EDGELAB_ADMIN_EMAIL ?? "").trim().toLowerCase();
  let candidate = configured ? db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(configured) : null;
  if (!candidate) {
    const users = Number(db.prepare("SELECT COUNT(*) AS total FROM users").get().total);
    if (users === 1) candidate = db.prepare("SELECT id FROM users LIMIT 1").get();
  }
  if (candidate) db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidate.id);
}

export function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}



