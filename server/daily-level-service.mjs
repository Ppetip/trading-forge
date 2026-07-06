import { randomUUID } from "node:crypto";
import { candleFingerprint, reportCacheKey } from "./cache.mjs";
import { DAILY_LEVEL_ENGINE_VERSION, runDailyLevelBacktest } from "./daily-level-engine.mjs";
import { assertUsage, recordUsage } from "./plans.mjs";
import { assertStoredLimit, hydrateReport } from "./services.mjs";
import { requireObject } from "./validation.mjs";

export function resolveDailyLevelBacktest(db, account, body) {
  assertUsage(db, account, "backtest", "backtests");
  const rules = requireObject(body.rules, "Rules");
  const dataFingerprint = candleFingerprint(body.candles);
  const cacheKey = reportCacheKey({ rules, engineParameters: null, dataFingerprint, engineVersion: DAILY_LEVEL_ENGINE_VERSION });
  const own = db.prepare("SELECT * FROM reports WHERE user_id = ? AND cache_key = ?").get(account.id, cacheKey);
  if (own) {
    recordUsage(db, account.id, "backtest_cache_hit", { reportId: own.id });
    return { status: 200, cached: true, report: hydrateReport(own) };
  }
  assertStoredLimit(db, account, "reports", "savedReports");
  const shared = db.prepare("SELECT result_json FROM reports WHERE cache_key = ? LIMIT 1").get(cacheKey);
  const result = shared ? JSON.parse(shared.result_json) : runDailyLevelBacktest(rules, body.candles);
  const id = randomUUID(), createdAt = new Date().toISOString(), visibility = body.visibility === "public" ? "public" : "private";
  db.prepare("INSERT INTO reports (id, user_id, strategy_version_id, cache_key, engine_version, data_fingerprint, data_provenance_json, rules_json, result_json, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, account.id, body.strategyVersionId ?? null, cacheKey, DAILY_LEVEL_ENGINE_VERSION, dataFingerprint, body.dataProvenance ? JSON.stringify(body.dataProvenance) : null, JSON.stringify(rules), JSON.stringify(result), visibility, createdAt);
  recordUsage(db, account.id, "backtest", { reportId: id, cachedCompute: Boolean(shared), symbol: rules.symbol, timeframe: rules.timeframe, strategyType: rules.strategyType });
  recordUsage(db, account.id, "report_generated", { reportId: id });
  return { status: 201, cached: Boolean(shared), report: { id, cacheKey, engineVersion: DAILY_LEVEL_ENGINE_VERSION, dataFingerprint, dataProvenance: body.dataProvenance ?? null, createdAt, visibility, rules, result } };
}

