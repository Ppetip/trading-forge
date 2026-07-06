import { strategyHash as hashStrategy } from "./cache.mjs";

export const ORB_ENGINE_VERSION = "orb-1.1.0";

const DEFAULT_CONFLICT_MODE = "stop_first";

function error(message, code = "ORB_VALIDATION_ERROR") {
  const next = new Error(message);
  next.status = 400;
  next.code = code;
  return next;
}

function timeframeMinutes(timeframe) {
  const value = Number.parseInt(String(timeframe), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function validateRules(rules) {
  const required = ["symbol", "timeframe", "sessionTime", "openingRangeMinutes", "rewardRisk", "direction", "maxTradesPerDay"];
  for (const key of required) if (rules?.[key] === undefined || rules[key] === null || rules[key] === "") throw error(`Missing rule: ${key}.`);
  if (!["1m", "5m", "15m"].includes(rules.timeframe)) throw error("Unsupported timeframe.");
  if (![5, 15, 30, 60].includes(Number(rules.openingRangeMinutes))) throw error("Unsupported opening range.");
  if (Number(rules.rewardRisk) < 0.25 || Number(rules.rewardRisk) > 20) throw error("Reward/risk must be between 0.25 and 20.");
  if (!["long_and_short", "long_only", "short_only"].includes(rules.direction)) throw error("Unsupported ORB direction.");
  if (String(rules.sessionTime).startsWith("09:30") && rules.timezone && rules.timezone !== "America/New_York") {
    throw error("A 9:30 ORB must use America/New_York unless the session is explicitly changed.");
  }
}

function validateCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 2) throw error("At least two candles are required.");
  for (const [index, candle] of candles.entries()) {
    if (!candle.timestamp || !Number.isFinite(candle.open) || !Number.isFinite(candle.high) || !Number.isFinite(candle.low) || !Number.isFinite(candle.close)) throw error(`Invalid candle at index ${index}.`);
    if (candle.high < candle.low || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) throw error(`Impossible OHLC candle at index ${index}.`);
  }
}

function dateTimeParts(timestamp, timezone) {
  if (!timezone || timezone === "UTC" || !timestamp.includes("Z")) return { date: timestamp.slice(0, 10), time: timestamp.slice(11, 16) };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(timestamp)).reduce((memo, part) => ({ ...memo, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function candleAudit(candles, timeframe) {
  const sorted = [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const seen = new Set();
  let duplicateBars = 0, missingBars = 0;
  const stepMs = timeframeMinutes(timeframe) * 60_000;
  for (let index = 0; index < sorted.length; index += 1) {
    const stamp = sorted[index].timestamp;
    if (seen.has(stamp)) duplicateBars += 1;
    seen.add(stamp);
    if (index > 0 && stepMs) {
      const gap = Date.parse(sorted[index].timestamp) - Date.parse(sorted[index - 1].timestamp);
      if (gap > stepMs * 1.5 && sorted[index].timestamp.slice(0, 10) === sorted[index - 1].timestamp.slice(0, 10)) {
        missingBars += Math.max(1, Math.round(gap / stepMs) - 1);
      }
    }
  }
  return {
    sorted,
    firstBar: sorted[0]?.timestamp ?? null,
    lastBar: sorted.at(-1)?.timestamp ?? null,
    barCount: sorted.length,
    missingBars,
    duplicateBars
  };
}

function summarize(rules, trades, auditBase) {
  let totalR = 0, grossR = 0, feeR = 0, peak = 0, maxDrawdown = 0, streak = 0, longestLosingStreak = 0;
  const equity = [0], drawdown = [0], monthMap = new Map();
  for (const trade of trades) {
    grossR += trade.grossR;
    feeR += trade.feeR;
    totalR += trade.netR;
    peak = Math.max(peak, totalR);
    const currentDrawdown = peak - totalR;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    streak = trade.netR < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
    equity.push(totalR);
    drawdown.push(-currentDrawdown);
    const month = trade.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + trade.netR);
  }
  const wins = trades.filter((trade) => trade.status === "Win").length;
  const ambiguousTrades = trades.filter((trade) => trade.ambiguous).length;
  const losses = trades.length - wins - ambiguousTrades;
  const profit = trades.filter((trade) => trade.netR > 0).reduce((sum, trade) => sum + trade.netR, 0);
  const loss = Math.abs(trades.filter((trade) => trade.netR < 0).reduce((sum, trade) => sum + trade.netR, 0));
  const monthly = [...monthMap].map(([month, value]) => ({ month, value }));
  const ranked = [...monthly].sort((a, b) => a.value - b.value);
  const audit = {
    ...auditBase,
    tradeCount: trades.length,
    wins,
    losses,
    ambiguousTrades,
    grossR,
    feeR,
    netR: totalR
  };
  audit.verification = verificationGate(audit);
  return {
    dataSource: "server", engineVersion: ORB_ENGINE_VERSION, rules, trades, totalR,
    averageR: trades.length ? totalR / trades.length : 0, winRate: trades.length ? wins / trades.length * 100 : 0,
    wins, losses, ambiguousTrades, profitFactor: loss ? profit / loss : profit ? null : 0,
    maxDrawdown, longestLosingStreak, equity, drawdown, monthly,
    bestMonth: ranked.at(-1) ?? null, worstMonth: ranked[0] ?? null,
    audit
  };
}

function verificationGate(audit) {
  const criticalErrors = [];
  if (!audit.providerMetadataAvailable) criticalErrors.push("provider_metadata_missing");
  if (!audit.symbolMappingConfirmed) criticalErrors.push("symbol_mapping_unconfirmed");
  if (!audit.timezoneNormalizationConfirmed) criticalErrors.push("timezone_normalization_unconfirmed");
  if (audit.missingBars > 0) criticalErrors.push("missing_bars_detected");
  if (audit.duplicateBars > 0) criticalErrors.push("duplicate_bars_detected");
  if (audit.engineVersion !== ORB_ENGINE_VERSION) criticalErrors.push("engine_version_not_current");
  criticalErrors.push(...(audit.criticalValidationErrors ?? []));
  if (audit.failed) return { status: "failed_backtest_run", label: "Failed Backtest Run", criticalErrors };
  if (criticalErrors.length) return { status: "unverified_legacy_report", label: "Unverified Legacy Report", criticalErrors };
  return { status: "verified_evidence", label: "Verified Evidence", criticalErrors: [] };
}

function tradeOutcome({ isLong, entry, stop, target, candles, rewardRisk, drag, conflictMode }) {
  for (const candle of candles) {
    const stopped = isLong ? candle.low <= stop : candle.high >= stop;
    const targeted = isLong ? candle.high >= target : candle.low <= target;
    if (stopped && targeted) {
      if (conflictMode === "target_first") return { grossR: rewardRisk, exitPrice: target, exitTime: candle.timestamp, exitReason: "target_first_conflict", ambiguous: true, status: "Win" };
      if (conflictMode === "ambiguous_as_zero") return { grossR: 0, exitPrice: entry, exitTime: candle.timestamp, exitReason: "same_candle_ambiguous", ambiguous: true, status: "Ambiguous" };
      return { grossR: -1, exitPrice: stop, exitTime: candle.timestamp, exitReason: "stop_first_conflict", ambiguous: true, status: "Loss" };
    }
    if (targeted) return { grossR: rewardRisk, exitPrice: target, exitTime: candle.timestamp, exitReason: "target", ambiguous: false, status: "Win" };
    if (stopped) return { grossR: -1, exitPrice: stop, exitTime: candle.timestamp, exitReason: "stop", ambiguous: false, status: "Loss" };
  }
  const last = candles.at(-1);
  const grossR = last ? (isLong ? (last.close - entry) / Math.abs(entry - stop) : (entry - last.close) / Math.abs(entry - stop)) : 0;
  return { grossR, exitPrice: last?.close ?? entry, exitTime: last?.timestamp ?? null, exitReason: "end_of_data", ambiguous: false, status: grossR > 0 ? "Win" : "Loss" };
}

export function runOrbBacktest(rules, sourceCandles, options = {}) {
  validateRules(rules);
  validateCandles(sourceCandles);
  const effectiveTimezone = rules.timezone ?? (String(rules.sessionTime).startsWith("09:30") ? "America/New_York" : "UTC");
  const auditCandles = candleAudit(sourceCandles, rules.timeframe);
  const candles = auditCandles.sorted.map((candle) => ({ ...candle, ...dateTimeParts(candle.timestamp, effectiveTimezone) }));
  const days = new Map();
  for (const candle of candles) days.set(candle.date, [...(days.get(candle.date) ?? []), candle]);

  const trades = [];
  const bars = Math.max(1, Math.ceil(Number(rules.openingRangeMinutes) / timeframeMinutes(rules.timeframe)));
  const conflictMode = rules.intrabarConflictMode ?? DEFAULT_CONFLICT_MODE;
  const drag = (rules.fees ? 0.025 : 0) + (rules.slippage ? 0.035 : 0);
  for (const [date, day] of days) {
    const start = day.findIndex((candle) => candle.time >= rules.sessionTime);
    if (start < 0 || day.length < start + bars + 1) continue;
    const range = day.slice(start, start + bars);
    const rangeHigh = Math.max(...range.map((candle) => candle.high));
    const rangeLow = Math.min(...range.map((candle) => candle.low));
    const risk = rangeHigh - rangeLow;
    if (risk <= 0) continue;
    const after = day.slice(start + bars);
    const confirmsLong = (candle) => rules.entryConfirmation === "candle_close" ? candle.close > rangeHigh : candle.high > rangeHigh;
    const confirmsShort = (candle) => rules.entryConfirmation === "candle_close" ? candle.close < rangeLow : candle.low < rangeLow;
    let selected = null;
    for (const [entryIndex, candle] of after.entries()) {
      const longBreak = rules.direction !== "short_only" && confirmsLong(candle);
      const shortBreak = rules.direction !== "long_only" && confirmsShort(candle);
      if (!longBreak && !shortBreak) continue;
      selected = { entryIndex, candle, isLong: longBreak && !shortBreak ? true : shortBreak && !longBreak ? false : candle.close >= (rangeHigh + rangeLow) / 2 };
      break;
    }
    if (!selected) continue;
    const { entryIndex, candle: entryCandle, isLong } = selected;
    const entry = isLong ? rangeHigh : rangeLow;
    const stop = isLong ? rangeLow : rangeHigh;
    const target = isLong ? entry + risk * rules.rewardRisk : entry - risk * rules.rewardRisk;
    const outcome = tradeOutcome({ isLong, entry, stop, target, candles: after.slice(entryIndex), rewardRisk: Number(rules.rewardRisk), drag, conflictMode });
    trades.push({
      id: trades.length + 1,
      date,
      time: entryCandle.time,
      rangeHigh,
      rangeLow,
      rangeStart: range[0].timestamp,
      rangeEnd: range.at(-1).timestamp,
      entryTime: entryCandle.timestamp,
      entryPrice: entry,
      exitTime: outcome.exitTime,
      exitPrice: outcome.exitPrice,
      exitReason: outcome.exitReason,
      direction: isLong ? "Long" : "Short",
      entry,
      stop,
      target,
      grossR: outcome.grossR,
      feeR: drag,
      netR: outcome.grossR - drag,
      resultR: outcome.grossR - drag,
      status: outcome.status,
      ambiguous: outcome.ambiguous
    });
    if (Number(rules.maxTradesPerDay) === 1) continue;
  }

  const provenance = options.dataProvenance ?? {};
  return summarize(rules, trades, {
    engineVersion: ORB_ENGINE_VERSION,
    strategyHash: options.strategyHash ?? hashStrategy(rules),
    cacheKey: options.cacheKey ?? null,
    provider: provenance.provider ?? rules.provider ?? null,
    requestedSymbol: provenance.requestedSymbol ?? rules.requestedSymbol ?? rules.symbol,
    providerSymbol: provenance.resolvedSymbol ?? provenance.providerSymbol ?? rules.providerSymbol ?? rules.symbol,
    assetClass: rules.assetClass ?? rules.market ?? "unknown",
    timeframe: rules.timeframe,
    timezone: effectiveTimezone,
    firstBar: auditCandles.firstBar,
    lastBar: auditCandles.lastBar,
    barCount: auditCandles.barCount,
    missingBars: auditCandles.missingBars,
    duplicateBars: auditCandles.duplicateBars,
    providerMetadataAvailable: Boolean(options.dataProvenance),
    symbolMappingConfirmed: Boolean(provenance.resolvedSymbol ?? provenance.providerSymbol ?? rules.providerSymbol ?? rules.symbol),
    timezoneNormalizationConfirmed: Boolean(effectiveTimezone),
    sessionTime: rules.sessionTime,
    openingRangeMinutes: Number(rules.openingRangeMinutes),
    entryRule: rules.entryRule ?? rules.entryConfirmation ?? "wick_break",
    stopRule: rules.stopRule ?? "opposite_side_of_opening_range",
    rewardRisk: Number(rules.rewardRisk),
    direction: rules.direction,
    maxTradesPerDay: Number(rules.maxTradesPerDay),
    intrabarConflictMode: conflictMode,
    fees: Boolean(rules.fees),
    slippage: Boolean(rules.slippage),
    criticalValidationErrors: []
  });
}
