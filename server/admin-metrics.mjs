import { getDataControls } from "./admin-controls.mjs";
const number = (value) => Number(value ?? 0);
const roundMoney = (value) => Math.round(number(value) * 10000) / 10000;

export function comprehensiveAdminMetrics(db) {
  const scalar = (sql, ...params) => number(db.prepare(sql).get(...params).total);
  const totalUsers = scalar("SELECT COUNT(*) AS total FROM users");
  const totalStrategies = scalar("SELECT COUNT(*) AS total FROM strategies");
  const totalReports = scalar("SELECT COUNT(*) AS total FROM reports");
  const freeUsers = scalar("SELECT COUNT(*) AS total FROM subscriptions WHERE plan = 'free' OR status IN ('past_due', 'canceled')");
  const trialUsers = scalar("SELECT COUNT(*) AS total FROM subscriptions WHERE plan = 'trial' AND status = 'trialing'");
  const paidUsers = scalar("SELECT COUNT(*) AS total FROM subscriptions WHERE plan = 'pro' AND status = 'active'");
  const canceledUsers = scalar("SELECT COUNT(*) AS total FROM subscriptions WHERE status = 'canceled'");
  const eventCount = (type) => scalar("SELECT COALESCE(SUM(quantity), 0) AS total FROM usage_events WHERE event_type = ?", type);
  const costRows = db.prepare(`
    SELECT user_id,
      COALESCE(SUM(CAST(json_extract(metadata_json, '$.apiCostUsd') AS REAL)), 0) AS api_cost,
      COALESCE(SUM(CAST(json_extract(metadata_json, '$.computeCostUsd') AS REAL)), 0) AS compute_cost
    FROM usage_events GROUP BY user_id
  `).all();
  return {
    totalUsers,
    strategies: totalStrategies,
    reports: totalReports,
    generatedAt: new Date().toISOString(),
    users: {
      total: totalUsers,
      newSignups30d: scalar("SELECT COUNT(*) AS total FROM users WHERE created_at >= datetime('now', '-30 days')"),
      free: freeUsers, trial: trialUsers, paid: paidUsers,
      conversionRate: totalUsers ? paidUsers / totalUsers : 0,
      churnRate: paidUsers + canceledUsers ? canceledUsers / (paidUsers + canceledUsers) : 0
    },
    activity: {
      backtests: eventCount("backtest"),
      reports: eventCount("report_generated"),
      strategiesSaved: eventCount("strategy_saved"),
      pineExports: eventCount("pine_export"),
      transcriptUploads: eventCount("transcript_upload"),
      transcriptExtractions: eventCount("transcript_extraction"),
      failedTests: eventCount("backtest_failed")
    },
    popular: {
      symbols: db.prepare("SELECT json_extract(metadata_json, '$.symbol') AS name, SUM(quantity) AS total FROM usage_events WHERE event_type = 'backtest' GROUP BY name ORDER BY total DESC LIMIT 10").all(),
      timeframes: db.prepare("SELECT json_extract(metadata_json, '$.timeframe') AS name, SUM(quantity) AS total FROM usage_events WHERE event_type = 'backtest' GROUP BY name ORDER BY total DESC LIMIT 10").all(),
      strategies: db.prepare("SELECT json_extract(metadata_json, '$.strategyType') AS name, SUM(quantity) AS total FROM usage_events WHERE event_type = 'backtest' GROUP BY name ORDER BY total DESC LIMIT 10").all()
    },
    costs: {
      apiTotalUsd: roundMoney(costRows.reduce((sum, row) => sum + number(row.api_cost), 0)),
      computeTotalUsd: roundMoney(costRows.reduce((sum, row) => sum + number(row.compute_cost), 0)),
      byUser: costRows.map((row) => ({ userId: row.user_id, apiUsd: roundMoney(row.api_cost), computeUsd: roundMoney(row.compute_cost) }))
    },
    dataSpend: {
      controls: getDataControls(db),
      requests: eventCount("data_request_started"),
      cacheHits: eventCount("data_cache_hit"),
      cacheMisses: eventCount("data_cache_miss"),
      providerFetches: eventCount("data_provider_fetch"),
      providerErrors: eventCount("data_provider_error"),
      premiumBlocked: eventCount("premium_data_blocked"),
      premiumBudgetUsed: eventCount("premium_data_budget_used"),
      proxyUses: eventCount("proxy_symbol_used"),
      premiumRows: scalar("SELECT COALESCE(SUM(CAST(json_extract(metadata_json, '$.rowsReturned') AS INTEGER)),0) AS total FROM usage_events WHERE event_type='data_provider_fetch' AND json_extract(metadata_json, '$.provider')='databento'"),
      providers: db.prepare("SELECT COALESCE(json_extract(metadata_json, '$.provider'),'unknown') AS name, SUM(quantity) AS total FROM usage_events WHERE event_type IN ('data_provider_fetch','data_cache_hit','data_provider_error') GROUP BY name ORDER BY total DESC").all(),
      symbols: db.prepare("SELECT COALESCE(json_extract(metadata_json, '$.resolvedSymbol'),json_extract(metadata_json, '$.symbol'),'unknown') AS name, SUM(quantity) AS total FROM usage_events WHERE event_type LIKE 'data_%' GROUP BY name ORDER BY total DESC LIMIT 10").all()
    }
  };
}
