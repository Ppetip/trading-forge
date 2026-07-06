import "./env.mjs";
import { createDatabase } from "./db.mjs";
import { routeMarketData } from "./market-data-router.mjs";
import { runOrbBacktest } from "./orb-engine.mjs";
import { reportCacheKey, strategyHash } from "./cache.mjs";

const db = createDatabase();
const account = db.prepare("SELECT u.*, s.plan, s.status AS subscription_status, s.trial_ends_at, s.current_period_ends_at FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE u.role = 'admin' ORDER BY u.created_at LIMIT 1").get();
if (!account) throw new Error("No admin account exists.");
const base = { strategyType: "opening_range_breakout", market: "Futures", assetClass: "ETF", timeframe: "15m", dateRange: "30d", sessionTime: "09:30", timezone: "America/New_York", openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range", direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true, intrabarConflictMode: "stop_first" };
const templates = [{ name: "Opening range breakout", symbol: "SPY", rewardRisk: 3 }, { name: "QQQ 9:30 AM ORB", symbol: "QQQ", rewardRisk: 1 }, { name: "9:30 AM ORB", symbol: "SPY", rewardRisk: 2 }];
const output = [];
for (const template of templates) {
  try {
    const rules = { ...base, ...template };
    const routed = await routeMarketData({ db, account, rules, preferredProvider: "yahoo" });
    const cacheKey = reportCacheKey({ rules: { ...rules, provider: routed.dataProvenance.provider, requestedSymbol: routed.dataProvenance.requestedSymbol, providerSymbol: routed.dataProvenance.resolvedSymbol, start: routed.dataProvenance.start, end: routed.dataProvenance.end }, dataFingerprint: "template-audit", engineVersion: "orb-1.1.0" });
    const result = runOrbBacktest(rules, routed.candles, { cacheKey, strategyHash: strategyHash(rules), dataProvenance: routed.dataProvenance });
    output.push({ ...template, status: "tested", totalR: result.totalR, averageR: result.averageR, winRate: result.winRate, profitFactor: result.profitFactor, maxDrawdown: result.maxDrawdown, trades: result.trades.length, verification: result.audit.verification.label, provider: routed.dataProvenance.provider, providerSymbol: routed.dataProvenance.resolvedSymbol });
  } catch (error) { output.push({ ...template, status: "failed", code: error.code ?? "ERROR", message: error.message }); }
}
console.log(JSON.stringify(output, null, 2));
db.close();