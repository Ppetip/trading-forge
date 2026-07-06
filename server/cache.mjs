import { createHash } from "node:crypto";

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function candleFingerprint(candles) {
  if (!Array.isArray(candles) || !candles.length) throw new Error("At least one candle is required.");
  const digest = createHash("sha256");
  digest.update(`candles-v2:${candles.length}\n`);
  for (const candle of candles) {
    digest.update(stableStringify([
      candle.timestamp,
      Number(candle.open),
      Number(candle.high),
      Number(candle.low),
      Number(candle.close)
    ]));
    digest.update("\n");
  }
  return digest.digest("hex");
}

export function reportCacheKey({ rules, engineParameters, dataFingerprint, engineVersion }) {
  return sha256(stableStringify({
    cacheSchema: "report-cache-v2",
    rules: normalizeRulesForCache(rules),
    engineParameters: engineParameters ?? null,
    dataFingerprint,
    engineVersion
  }));
}

export function strategyHash(rules) {
  return sha256(stableStringify({
    hashSchema: "strategy-v1",
    rules: normalizeRulesForCache(rules)
  }));
}

export function normalizeRulesForCache(rules = {}) {
  return {
    provider: rules.provider ?? null,
    providerSymbol: rules.providerSymbol ?? rules.resolvedSymbol ?? null,
    requestedSymbol: rules.requestedSymbol ?? rules.symbol ?? null,
    assetClass: rules.assetClass ?? rules.market ?? null,
    timeframe: rules.timeframe ?? null,
    dateRange: rules.dateRange ?? null,
    start: rules.start ?? rules.startDate ?? null,
    end: rules.end ?? rules.endDate ?? null,
    timezone: rules.timezone ?? null,
    strategyType: rules.strategyType ?? rules.strategy_type ?? null,
    openingRangeStart: rules.openingRangeStart ?? rules.sessionTime ?? null,
    openingRangeMinutes: rules.openingRangeMinutes ?? null,
    entryRule: rules.entryRule ?? rules.entryConfirmation ?? null,
    stopRule: rules.stopRule ?? null,
    rewardRisk: rules.rewardRisk ?? null,
    direction: rules.direction ?? null,
    maxTradesPerDay: rules.maxTradesPerDay ?? null,
    fees: Boolean(rules.fees),
    slippage: Boolean(rules.slippage),
    intrabarConflictMode: rules.intrabarConflictMode ?? "stop_first"
  };
}
