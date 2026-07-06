import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchDatabentoCandles } from "./databento.mjs";
import { getDataControls } from "./admin-controls.mjs";
import { assertUsage, effectivePlan, recordUsage } from "./plans.mjs";

export const FUTURES_PROXIES = Object.freeze({ NQ: "QQQ", ES: "SPY", RTY: "IWM", YM: "DIA", GC: "GLD", CL: "USO" });
const CACHE_VERSION = 2;
const NORMALIZATION_VERSION = "ohlc-v1";
const CACHE_ROOT = resolve(process.env.MARKET_DATA_CACHE_PATH ?? "data/market-cache", "providers");
const PREMIUM_PLANS = new Set(["pro", "power"]);

function marketError(message, code, status = 422, details) {
  const error = new Error(message); error.code = code; error.status = status;
  if (details) error.details = details;
  return error;
}
function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase().replace(/=F$/, "");
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw marketError("Use a valid market symbol.", "INVALID_SYMBOL", 400);
  return symbol;
}
function requestedYears(rules) {
  const match = String(rules?.dateRange ?? "1y").match(/(\d+(?:\.\d+)?)\s*y/i);
  return Math.max(1, Math.min(5, match ? Number(match[1]) : 1));
}
function requestedYearsRaw(rules) {
  const text = String(rules?.dateRange ?? "1y");
  const yearMatch = text.match(/(\d+(?:\.\d+)?)\s*y/i);
  if (yearMatch) return Number(yearMatch[1]);
  const monthMatch = text.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (monthMatch) return Number(monthMatch[1]) / 12;
  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*d/i);
  if (dayMatch) return Number(dayMatch[1]) / 365;
  return 1;
}
function yahooInterval(timeframe) {
  return ({ "1m": "1m", "2m": "2m", "5m": "5m", "15m": "15m", "30m": "30m", "60m": "60m", "1h": "60m", "1d": "1d" })[String(timeframe ?? "1d").toLowerCase()] ?? "1d";
}
function dateWindow(rules, now = new Date()) {
  const end = new Date(now), interval = yahooInterval(rules?.timeframe), intraday = interval !== "1d";
  const maxDays = interval === "1m" ? 7 : 59, start = new Date(end);
  if (intraday) start.setUTCDate(start.getUTCDate() - Math.min(maxDays, requestedDays(rules))); else start.setUTCFullYear(start.getUTCFullYear() - requestedYears(rules));
  return { start, end, interval, intraday, maxDays };
}
function requestedDays(rules) { return Math.ceil(requestedYearsRaw(rules) * 365); }
function cacheIdentity(query) {
  return { cacheVersion: CACHE_VERSION, normalizationVersion: NORMALIZATION_VERSION, provider: query.provider, dataset: query.dataset ?? null,
    requestedSymbol: query.requestedSymbol, resolvedSymbol: query.resolvedSymbol, interval: query.interval, start: query.start, end: query.end,
    timezone: query.timezone, adjusted: query.adjusted, continuous: query.continuous };
}
function cachePath(identity) { return resolve(CACHE_ROOT, `${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.json`); }
async function readCache(identity) {
  try { const payload = JSON.parse(await readFile(cachePath(identity), "utf8")); return Array.isArray(payload.candles) ? payload : null; } catch { return null; }
}
async function writeCache(identity, candles, providerMetadata) {
  await mkdir(CACHE_ROOT, { recursive: true });
  const target = cachePath(identity), temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, identity, providerMetadata, cachedAt: new Date().toISOString(), candles }));
  await rename(temporary, target);
}
function provenance(query, overrides = {}) {
  return { provider: query.provider, grade: query.provider === "databento" ? "premium" : query.provider === "uploaded" ? "uploaded" : "research",
    requestedSymbol: query.requestedSymbol, resolvedSymbol: query.resolvedSymbol, interval: query.interval, start: query.start, end: query.end,
    proxy: query.requestedSymbol !== query.resolvedSymbol, dataset: query.dataset ?? null, adjusted: Boolean(query.adjusted), continuous: Boolean(query.continuous),
    cacheHit: Boolean(overrides.cacheHit), providerCalls: Number(overrides.providerCalls ?? 0), costScore: overrides.costScore ?? "low" };
}
function normalizeYahooCandles(chart) {
  const timestamps = chart.timestamp ?? [], quote = chart.indicators?.quote?.[0] ?? {}, adjusted = chart.indicators?.adjclose?.[0]?.adjclose;
  return timestamps.map((timestamp, index) => ({ timestamp: new Date(timestamp * 1000).toISOString().slice(0, 19), open: Number(quote.open?.[index]),
    high: Number(quote.high?.[index]), low: Number(quote.low?.[index]), close: Number(adjusted?.[index] ?? quote.close?.[index]) }))
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
}
async function fetchYahoo(query, fetchImpl) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(query.resolvedSymbol)}`);
  url.searchParams.set("period1", String(Math.floor(new Date(query.start).getTime() / 1000))); url.searchParams.set("period2", String(Math.floor(new Date(query.end).getTime() / 1000)));
  url.searchParams.set("interval", query.interval); url.searchParams.set("events", "div,splits"); url.searchParams.set("includeAdjustedClose", "true");
  const response = await fetchImpl(url, { headers: { "user-agent": "EdgeLab research validator/1.0" } });
  if (!response.ok) throw marketError("Research-grade market data is temporarily unavailable.", "RESEARCH_DATA_FAILED", 502);
  const payload = await response.json(), chart = payload?.chart?.result?.[0];
  if (!chart) throw marketError("No research-grade candles were available for this symbol and window.", "NO_MARKET_DATA");
  const candles = normalizeYahooCandles(chart);
  if (!candles.length) throw marketError("No research-grade candles were available for this symbol and window.", "NO_MARKET_DATA");
  return { candles, metadata: { exchange: chart.meta?.exchangeName, currency: chart.meta?.currency } };
}
export function estimateDataCost({ provider, cacheHit, estimatedCandles = 0, providerCalls = 0 }) {
  if (cacheHit || provider === "uploaded") return "low";
  if (provider === "databento" && (estimatedCandles > 100000 || providerCalls > 6)) return "high";
  if (provider === "databento" || estimatedCandles > 50000) return "medium";
  return "low";
}

export async function routeMarketData({ db, account, rules, candles, fetchImpl = fetch, now = new Date(), preferredProvider }) {
  const requestedSymbol = normalizeSymbol(rules?.symbol), plan = effectivePlan(account, now);
  const rawYears = requestedYearsRaw(rules);
  const controls = await getDataControls(db);
  if (rawYears > 5) throw marketError("That backtest window is too large for an online on-demand run. Choose 5 years or less, upload your own candles, or split the test into smaller windows.",
    "UNREALISTIC_BACKTEST_WINDOW", 422, { requestedYears: rawYears, maxYears: 5, options: ["Choose a range of 5 years or less", "Upload your own candles", "Split the request into smaller backtests"] });
  if (controls.disableLongWindows && rawYears > 1) throw marketError("Long-window tests are temporarily disabled by admin data-spend controls. Choose one year or less, upload candles, or retry later.",
    "DATA_CONTROL_LONG_WINDOWS_DISABLED", 503, { requestedYears: rawYears, maxYears: 1 });
  if (Array.isArray(candles) && candles.length) {
    const times = candles.map((item) => item.timestamp).filter(Boolean).sort();
    const query = { provider: "uploaded", requestedSymbol, resolvedSymbol: requestedSymbol, interval: String(rules?.timeframe ?? ""),
      start: times[0] ?? null, end: times.at(-1) ?? null, adjusted: false, continuous: false };
    return { candles, dataProvenance: provenance(query), cacheKey: null };
  }
  const futureProxy = FUTURES_PROXIES[requestedSymbol], window = dateWindow(rules, now);
  if (controls.forceDailyCandles && window.intraday) throw marketError("Intraday tests are temporarily disabled by admin data-spend controls. Use daily candles or retry later.",
    "DATA_CONTROL_DAILY_ONLY", 503, { requestedTimeframe: rules?.timeframe, allowedTimeframe: "1d" });
  const forceProxy = Boolean(controls.forceProxyForFutures && futureProxy);
  const premiumAllowed = PREMIUM_PLANS.has(plan) && !forceProxy;
  const wantsPremium = preferredProvider === "databento" || rules?.dataProvider === "databento";
  const longIntradayResearchRequest = window.intraday && requestedDays(rules) > window.maxDays;
  if (longIntradayResearchRequest && (!premiumAllowed || forceProxy)) {
    const proxyText = futureProxy ? ` Free mode can test ${futureProxy} as a daily proxy, but it cannot run ${requestedSymbol} multi-year intraday futures.` : "";
    const upgradeText = PREMIUM_PLANS.has(plan) ? "Upload your own candles or reduce the window." : "Upgrade to Pro for premium intraday data, upload your own candles, or reduce the window.";
    throw marketError(`Research-grade intraday data cannot cover ${rules.dateRange ?? "that long"} at ${rules.timeframe}. ${window.interval} research data is limited to about ${window.maxDays} days.${proxyText} ${upgradeText}`,
      "PREMIUM_INTRADAY_REQUIRED", PREMIUM_PLANS.has(plan) ? 422 : 402, {
        plan,
        requestedSymbol,
        proxySymbol: futureProxy ?? null,
        timeframe: rules.timeframe,
        dateRange: rules.dateRange,
        researchLimitDays: window.maxDays,
        upgradePlan: PREMIUM_PLANS.has(plan) ? null : "pro",
        options: [PREMIUM_PLANS.has(plan) ? "Run a shorter research-grade window" : "Upgrade to Pro for premium intraday data", futureProxy ? `Run a research-grade ${futureProxy} proxy instead` : "Run a shorter research-grade window", "Upload your own candles"]
      });
  }
  if (wantsPremium && !premiumAllowed && !forceProxy) throw marketError(`${requestedSymbol} premium futures data requires Pro. Use ${futureProxy ?? "a stock or ETF proxy"}, upload candles, or upgrade.`,
    "PREMIUM_DATA_REQUIRED", 402, { plan, requestedSymbol, proxySymbol: futureProxy ?? null });

  if (premiumAllowed && (wantsPremium || futureProxy || longIntradayResearchRequest)) {
    if (controls.disableDatabento) throw marketError("Premium market-data downloads are temporarily disabled by admin controls. Use research-grade data, cached reports, or retry later.",
      "DATA_CONTROL_DATABENTO_DISABLED", 503, { provider: "databento" });
    if (controls.cachedDatabentoOnly) throw marketError("Fresh premium market-data downloads are temporarily disabled. Cached premium reports can still be viewed, but new premium windows cannot run right now.",
      "DATA_CONTROL_DATABENTO_CACHED_ONLY", 503, { provider: "databento" });
    await assertUsage(db, account, "premium_data_backtest", "premiumDataBacktests", now);
    const query = { provider: "databento", dataset: futureProxy ? "GLBX.MDP3" : "EQUS.MINI", requestedSymbol, resolvedSymbol: requestedSymbol,
      interval: String(rules.timeframe ?? "5m"), start: window.start.toISOString(), end: window.end.toISOString(), timezone: rules.timezone ?? "America/New_York",
      adjusted: false, continuous: Boolean(futureProxy) };
    await recordUsage(db, account.id, "data_request_started", query);
    const result = await fetchDatabentoCandles(rules, { fetchImpl, returnMetadata: true });
    if (result.downloads > 0) await assertUsage(db, account, "premium_data_window", "newPremiumWindows", now);
    await recordUsage(db, account.id, result.downloads > 0 ? "data_provider_fetch" : "data_cache_hit", { ...query, rowsReturned: result.candles.length,
      providerCalls: result.providerCalls, cacheHit: result.downloads === 0 });
    if (result.downloads > 0) await recordUsage(db, account.id, "premium_data_window", query);
    await recordUsage(db, account.id, "premium_data_backtest", query);
    const costScore = estimateDataCost({ provider: "databento", cacheHit: result.downloads === 0, estimatedCandles: result.candles.length, providerCalls: result.providerCalls });
    return { candles: result.candles, dataProvenance: provenance(query, { cacheHit: result.downloads === 0, providerCalls: result.providerCalls, costScore }), cacheKey: null };
  }

  const resolvedSymbol = futureProxy ?? requestedSymbol;
  if (controls.disableYahoo) throw marketError("Research-grade market data is temporarily disabled by admin controls. Upload candles or retry later.",
    "DATA_CONTROL_YAHOO_DISABLED", 503, { provider: "yahoo", requestedSymbol, resolvedSymbol });
  const query = { provider: "yahoo", dataset: "chart", requestedSymbol, resolvedSymbol, interval: window.interval, start: window.start.toISOString(),
    end: window.end.toISOString(), timezone: rules.timezone ?? "America/New_York", adjusted: true, continuous: false };
  const identity = cacheIdentity(query), cached = await readCache(identity);
  await recordUsage(db, account.id, "data_request_started", query);
  if (cached) {
    await recordUsage(db, account.id, "data_cache_hit", { ...query, cacheKey: cachePath(identity), rowsReturned: cached.candles.length });
    return { candles: cached.candles, dataProvenance: provenance(query, { cacheHit: true }), cacheKey: cachePath(identity) };
  }
  await recordUsage(db, account.id, "data_cache_miss", query);
  let result;
  try { result = await fetchYahoo(query, fetchImpl); }
  catch (error) { await recordUsage(db, account.id, "data_provider_error", { ...query, errorCode: error.code ?? "RESEARCH_DATA_FAILED" }); throw error; }
  await writeCache(identity, result.candles, result.metadata);
  await recordUsage(db, account.id, "data_provider_fetch", { ...query, rowsReturned: result.candles.length, providerCalls: 1 });
  if (futureProxy) await recordUsage(db, account.id, "proxy_symbol_used", query);
  return { candles: result.candles, dataProvenance: provenance(query, { providerCalls: 1,
    costScore: estimateDataCost({ provider: "yahoo", estimatedCandles: result.candles.length, providerCalls: 1 }) }), cacheKey: cachePath(identity) };
}
