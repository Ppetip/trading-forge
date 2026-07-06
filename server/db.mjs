import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_PATH = resolve("data", "edgelab.sqlite");

export function createDatabase(filename = process.env.EDGELAB_DB_PATH || DEFAULT_PATH) {
  if (process.env.DATABASE_URL && filename !== ":memory:" && process.env.EDGELAB_DB_DRIVER !== "sqlite") return createPostgresDatabase(process.env.DATABASE_URL);
  return createSqliteDatabase(filename);
}

function createSqliteDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  const adapter = {
    dialect: "sqlite",
    ready: Promise.resolve(),
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    close: () => db.close()
  };
  adapter.exec(SQLITE_SCHEMA);
  migrateSubscriptionsPlanCheck(adapter);
  const reportColumns = adapter.prepare("PRAGMA table_info(reports)").all();
  if (!reportColumns.some((column) => column.name === "data_provenance_json")) adapter.exec("ALTER TABLE reports ADD COLUMN data_provenance_json TEXT");
  bootstrapAdmin(adapter);
  return adapter;
}

function createPostgresDatabase(connectionString) {
  const adapter = {
    dialect: "postgres",
    ready: null,
    pool: null,
    prepare(sql) {
      return {
        get: async (...params) => (await adapter.queryOne(sql, params)) ?? undefined,
        all: async (...params) => await adapter.queryAll(sql, params),
        run: async (...params) => await adapter.queryRun(sql, params)
      };
    },
    exec: async (sql) => {
      await adapter.pool.query(sql);
    },
    queryAll: async (sql, params = []) => {
      const result = await adapter.pool.query(convertSql(sql), params);
      return result.rows;
    },
    queryOne: async (sql, params = []) => {
      const rows = await adapter.queryAll(sql, params);
      return rows[0] ?? null;
    },
    queryRun: async (sql, params = []) => {
      const result = await adapter.pool.query(convertSql(sql), params);
      return { changes: result.rowCount ?? 0 };
    },
    close: async () => {
      await adapter.pool?.end();
    }
  };
  adapter.ready = (async () => {
    const { Pool } = await import("@neondatabase/serverless");
    adapter.pool = new Pool({ connectionString, max: 1 });
    await adapter.exec(POSTGRES_SCHEMA);
    await bootstrapAdmin(adapter);
  })();
  return adapter;
}

function convertSql(sql) {
  let index = 0;
  let converted = "";
  let inSingle = false;
  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor];
    if (char === "'" && sql[cursor - 1] !== "\\") inSingle = !inSingle;
    if (char === "?" && !inSingle) converted += `$${++index}`;
    else converted += char;
  }
  return converted
    .replace(/json_extract\((\w+),\s*'\$\.([^']+)'\)/g, "($1::jsonb ->> '$2')")
    .replace(/datetime\('now',\s*'-30 days'\)/g, "(now() - interval '30 days')")
    .replace(/COUNT\(\*\) AS total/g, "COUNT(*)::int AS total")
    .replace(/SUM\(quantity\) AS total/g, "SUM(quantity)::int AS total")
    .replace(/COALESCE\(SUM\(quantity\), 0\) AS total/g, "COALESCE(SUM(quantity), 0)::int AS total")
    .replace(/CAST\(([^)]+) AS INTEGER\)/g, "CAST($1 AS integer)")
    .replace(/CAST\(([^)]+) AS REAL\)/g, "CAST($1 AS double precision)");
}

const CORE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
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
  data_provenance_json TEXT,
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

CREATE TABLE IF NOT EXISTS billing_events (
  provider_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
`;

const SQLITE_SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
${CORE_TABLES}
`;

const POSTGRES_SCHEMA = CORE_TABLES;

function migrateSubscriptionsPlanCheck(db) {
  if (db.dialect !== "sqlite") return;
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

async function bootstrapAdmin(db) {
  if (await db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) return;
  const configured = String(process.env.EDGELAB_ADMIN_EMAIL ?? "").trim().toLowerCase();
  let candidate = configured ? await db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(configured) : null;
  if (!candidate) {
    const users = Number((await db.prepare("SELECT COUNT(*) AS total FROM users").get()).total);
    if (users === 1) candidate = await db.prepare("SELECT id FROM users LIMIT 1").get();
  }
  if (candidate) await db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidate.id);
}

export async function transaction(db, callback) {
  if (db.dialect === "postgres") {
    await db.exec("BEGIN");
    try {
      const result = await callback();
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
