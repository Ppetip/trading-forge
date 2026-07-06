import { randomUUID } from "node:crypto";
import { transaction } from "./db.mjs";
import { accountUsage, assertUsage, effectivePlan, PLAN_LIMITS, recordUsage } from "./plans.mjs";
import { candleFingerprint, reportCacheKey, strategyHash } from "./cache.mjs";
import { ORB_ENGINE_VERSION, runOrbBacktest } from "./orb-engine.mjs";
import { badRequest, requireObject } from "./validation.mjs";

const timestamp = () => new Date().toISOString();

export async function accountView(db, row) {
  return {
    id: row.id, email: row.email, displayName: row.display_name, role: row.role,
    plan: effectivePlan(row), subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at, currentPeriodEndsAt: row.current_period_ends_at,
    usage: await accountUsage(db, row)
  };
}

async function tableCount(db, table, userId) {
  return Number((await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?`).get(userId)).total);
}

export async function assertStoredLimit(db, account, table, limitName) {
  const plan = effectivePlan(account), used = await tableCount(db, table, account.id), limit = PLAN_LIMITS[plan][limitName];
  if (used >= limit) {
    const error = new Error(`${limitName} limit reached for the ${plan} plan.`);
    error.status = 402; error.code = "PLAN_LIMIT_REACHED"; error.details = { plan, used, limit, limitName };
    throw error;
  }
}

export async function listStrategies(db, userId) {
  return await db.prepare(`
    SELECT s.*, COUNT(v.id) AS version_count, MAX(v.version_number) AS latest_version
    FROM strategies s LEFT JOIN strategy_versions v ON v.strategy_id = s.id
    WHERE s.user_id = ? AND s.archived = 0
    GROUP BY s.id ORDER BY s.updated_at DESC
  `).all(userId);
}

export async function createStrategy(db, account, body) {
  await assertStoredLimit(db, account, "strategies", "savedStrategies");
  const rules = requireObject(body.rules, "Rules");
  const id = randomUUID(), versionId = randomUUID(), createdAt = timestamp();
  await transaction(db, async () => {
    await db.prepare("INSERT INTO strategies (id, user_id, name, strategy_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, account.id, String(body.name ?? rules.name ?? "Untitled strategy").slice(0, 120), String(rules.strategyType), createdAt, createdAt);
    await db.prepare("INSERT INTO strategy_versions (id, strategy_id, version_number, prompt, rules_json, engine_parameters_json, change_summary, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)")
      .run(versionId, id, body.prompt ?? null, JSON.stringify(rules), body.engineParameters ? JSON.stringify(body.engineParameters) : null, body.changeSummary ?? "Initial version", createdAt);
    await recordUsage(db, account.id, "strategy_saved", { strategyId: id });
  });
  return { id, versionId, versionNumber: 1 };
}

export async function createStrategyVersion(db, account, strategyId, body) {
  const strategy = await db.prepare("SELECT * FROM strategies WHERE id = ? AND user_id = ?").get(strategyId, account.id);
  if (!strategy) return null;
  const rules = requireObject(body.rules, "Rules");
  const previous = await db.prepare("SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version_number DESC LIMIT 1").get(strategy.id);
  const id = randomUUID(), createdAt = timestamp(), versionNumber = Number(previous.version_number) + 1;
  await transaction(db, async () => {
    await db.prepare("INSERT INTO strategy_versions (id, strategy_id, version_number, parent_version_id, prompt, rules_json, engine_parameters_json, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, strategy.id, versionNumber, previous.id, body.prompt ?? null, JSON.stringify(rules), body.engineParameters ? JSON.stringify(body.engineParameters) : null, body.changeSummary ?? null, createdAt);
    await db.prepare("UPDATE strategies SET name = ?, strategy_type = ?, updated_at = ? WHERE id = ?")
      .run(String(body.name ?? rules.name ?? strategy.name).slice(0, 120), String(rules.strategyType), createdAt, strategy.id);
    await recordUsage(db, account.id, "strategy_version_created", { strategyId: strategy.id, versionNumber });
  });
  return { id, strategyId: strategy.id, versionNumber, parentVersionId: previous.id };
}

export async function strategyDetail(db, userId, strategyId) {
  const strategy = await db.prepare("SELECT * FROM strategies WHERE id = ? AND user_id = ?").get(strategyId, userId);
  if (!strategy) return null;
  const versions = (await db.prepare("SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version_number DESC").all(strategy.id)).map((row) => ({
    id: row.id, strategyId: row.strategy_id, versionNumber: row.version_number,
    parentVersionId: row.parent_version_id, prompt: row.prompt, changeSummary: row.change_summary,
    rules: JSON.parse(row.rules_json),
    engineParameters: row.engine_parameters_json ? JSON.parse(row.engine_parameters_json) : null,
    createdAt: row.created_at
  }));
  return { strategy, versions };
}

export async function resolveOrbBacktest(db, account, body) {
  await assertUsage(db, account, "backtest", "backtests");
  const rules = requireObject(body.rules, "Rules");
  if (rules.strategyType !== "opening_range_breakout") throw badRequest("This endpoint only executes opening range breakout rules.");
  const provenance = body.dataProvenance ?? null;
  const cacheRules = {
    ...rules,
    provider: provenance?.provider,
    requestedSymbol: provenance?.requestedSymbol ?? rules.symbol,
    providerSymbol: provenance?.resolvedSymbol ?? provenance?.providerSymbol,
    start: provenance?.start,
    end: provenance?.end,
    assetClass: rules.assetClass ?? rules.market
  };
  const dataFingerprint = candleFingerprint(body.candles);
  const cacheKey = reportCacheKey({ rules: cacheRules, engineParameters: null, dataFingerprint, engineVersion: ORB_ENGINE_VERSION });
  const own = await db.prepare("SELECT * FROM reports WHERE user_id = ? AND cache_key = ?").get(account.id, cacheKey);
  if (own) {
    await recordUsage(db, account.id, "backtest_cache_hit", { reportId: own.id });
    return { status: 200, cached: true, report: hydrateReport(own) };
  }
  await assertStoredLimit(db, account, "reports", "savedReports");
  const shared = await db.prepare("SELECT result_json FROM reports WHERE cache_key = ? LIMIT 1").get(cacheKey);
  const result = shared ? JSON.parse(shared.result_json) : runOrbBacktest(cacheRules, body.candles, { cacheKey, strategyHash: strategyHash(cacheRules), dataProvenance: provenance });
  const id = randomUUID(), createdAt = timestamp(), visibility = body.visibility === "public" ? "public" : "private";
  await transaction(db, async () => {
    await db.prepare("INSERT INTO reports (id, user_id, strategy_version_id, cache_key, engine_version, data_fingerprint, data_provenance_json, rules_json, result_json, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, account.id, body.strategyVersionId ?? null, cacheKey, ORB_ENGINE_VERSION, dataFingerprint, provenance ? JSON.stringify(provenance) : null, JSON.stringify(cacheRules), JSON.stringify(result), visibility, createdAt);
    await recordUsage(db, account.id, "backtest", { reportId: id, cachedCompute: Boolean(shared), symbol: rules.symbol, timeframe: rules.timeframe, strategyType: rules.strategyType });
    await recordUsage(db, account.id, "report_generated", { reportId: id });
  });
  return { status: 201, cached: Boolean(shared), report: { id, cacheKey, engineVersion: ORB_ENGINE_VERSION, dataFingerprint, dataProvenance: provenance, createdAt, visibility, rules: cacheRules, result } };
}

export function hydrateReport(row) {
  return {
    id: row.id, strategyVersionId: row.strategy_version_id, cacheKey: row.cache_key,
    engineVersion: row.engine_version, dataFingerprint: row.data_fingerprint,
    dataProvenance: row.data_provenance_json ? JSON.parse(row.data_provenance_json) : null,
    visibility: row.visibility, createdAt: row.created_at,
    rules: JSON.parse(row.rules_json), result: JSON.parse(row.result_json)
  };
}

export async function listPublicReports(db) {
  return (await db.prepare("SELECT * FROM reports WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 100").all()).map(hydrateReport);
}
export async function listReports(db, userId) {
  return (await db.prepare("SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId)).map(hydrateReport);
}

export async function reportDetail(db, account, id) {
  const row = await db.prepare("SELECT * FROM reports WHERE id = ? AND (user_id = ? OR visibility = 'public')").get(id, account.id);
  return row ? hydrateReport(row) : null;
}

export async function publicReportDetail(db, id) {
  const row = await db.prepare("SELECT * FROM reports WHERE id = ? AND visibility = 'public'").get(id);
  return row ? hydrateReport(row) : null;
}

export async function updateReportVisibility(db, userId, id, visibility) {
  if (!["private", "public"].includes(visibility)) throw badRequest("Visibility must be private or public.");
  const result = await db.prepare("UPDATE reports SET visibility = ? WHERE id = ? AND user_id = ?").run(visibility, id, userId);
  if (!result.changes) return null;
  await recordUsage(db, userId, "report_visibility_changed", { reportId: id, visibility });
  return hydrateReport(await db.prepare("SELECT * FROM reports WHERE id = ?").get(id));
}

export async function adminMetrics(db) {
  const scalar = async (sql) => Number((await db.prepare(sql).get()).total);
  return {
    totalUsers: await scalar("SELECT COUNT(*) AS total FROM users"),
    newSignups30d: await scalar("SELECT COUNT(*) AS total FROM users WHERE created_at >= datetime('now', '-30 days')"),
    strategies: await scalar("SELECT COUNT(*) AS total FROM strategies"),
    reports: await scalar("SELECT COUNT(*) AS total FROM reports"),
    failedTests: 0,
    plans: await db.prepare("SELECT plan, status, COUNT(*) AS total FROM subscriptions GROUP BY plan, status").all(),
    eventCounts: await db.prepare("SELECT event_type, SUM(quantity) AS total FROM usage_events GROUP BY event_type ORDER BY total DESC").all(),
    symbols: await db.prepare("SELECT json_extract(metadata_json, '$.symbol') AS symbol, COUNT(*) AS total FROM usage_events WHERE event_type = 'backtest' GROUP BY symbol ORDER BY total DESC LIMIT 10").all(),
    strategiesByType: await db.prepare("SELECT strategy_type, COUNT(*) AS total FROM strategies GROUP BY strategy_type ORDER BY total DESC").all()
  };
}




