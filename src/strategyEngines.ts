import type { BacktestResult, Candle, EngineParameterSnapshot, StrategyRules, Trade } from "./types";

export interface EngineParameters extends EngineParameterSnapshot {}
export const DEFAULT_ENGINE_PARAMETERS: EngineParameters = {
  fastMa: 9, slowMa: 21, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, lookback: 20, stopLookback: 5,
};
type Signal = { index: number; direction: "Long" | "Short"; entry: number; stop: number };

const low = (candles: Candle[], index: number, count: number) => Math.min(...candles.slice(Math.max(0, index - count + 1), index + 1).map((candle) => candle.low));
const high = (candles: Candle[], index: number, count: number) => Math.max(...candles.slice(Math.max(0, index - count + 1), index + 1).map((candle) => candle.high));
const allowed = (rules: StrategyRules, side: Signal["direction"]) =>
  rules.direction === "long_and_short" || rules.direction === "long_only" && side === "Long" || rules.direction === "short_only" && side === "Short";

function sma(values: number[], period: number, index: number) {
  if (index < period - 1) return Number.NaN;
  return values.slice(index - period + 1, index + 1).reduce((sum, value) => sum + value, 0) / period;
}

function rsi(values: number[], period: number) {
  const output = Array(values.length).fill(Number.NaN) as number[];
  for (let index = period; index < values.length; index += 1) {
    let gains = 0, losses = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const change = values[cursor] - values[cursor - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    output[index] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }
  return output;
}

function execute(rules: StrategyRules, candles: Candle[], signals: Signal[]) {
  const trades: Trade[] = [];
  const dailyCount = new Map<string, number>();
  let blockedUntil = -1;
  const drag = (rules.fees ? 0.025 : 0) + (rules.slippage ? 0.035 : 0);
  for (const signal of signals) {
    const date = candles[signal.index].timestamp.slice(0, 10);
    if (signal.index <= blockedUntil || !allowed(rules, signal.direction) || (dailyCount.get(date) ?? 0) >= rules.maxTradesPerDay) continue;
    const risk = Math.abs(signal.entry - signal.stop);
    if (!Number.isFinite(risk) || risk <= 0) continue;
    const target = signal.direction === "Long" ? signal.entry + risk * rules.rewardRisk : signal.entry - risk * rules.rewardRisk;
    let won = false, exitIndex = candles.length - 1;
    for (let index = signal.index + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      const stopped = signal.direction === "Long" ? candle.low <= signal.stop : candle.high >= signal.stop;
      const targeted = signal.direction === "Long" ? candle.high >= target : candle.low <= target;
      if (stopped || targeted) { won = targeted && !stopped; exitIndex = index; break; }
    }
    const timestamp = candles[signal.index].timestamp;
    trades.push({
      id: trades.length + 1, date, time: timestamp.slice(11, 16), direction: signal.direction,
      entry: signal.entry, stop: signal.stop, target, resultR: won ? rules.rewardRisk - drag : -1 - drag,
      status: won ? "Win" : "Loss",
    });
    dailyCount.set(date, (dailyCount.get(date) ?? 0) + 1);
    blockedUntil = exitIndex;
  }
  return trades;
}

function summarize(rules: StrategyRules, trades: Trade[], parameters: EngineParameters): BacktestResult {
  let totalR = 0, peak = 0, maxDrawdown = 0, streak = 0, longestLosingStreak = 0;
  const equity = [0], drawdown = [0], monthMap = new Map<string, number>();
  for (const trade of trades) {
    totalR += trade.resultR; peak = Math.max(peak, totalR);
    const currentDrawdown = peak - totalR;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    streak = trade.resultR < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
    equity.push(totalR); drawdown.push(-currentDrawdown);
    const month = trade.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + trade.resultR);
  }
  const wins = trades.filter((trade) => trade.status === "Win").length;
  const profit = trades.filter((trade) => trade.resultR > 0).reduce((sum, trade) => sum + trade.resultR, 0);
  const loss = Math.abs(trades.filter((trade) => trade.resultR < 0).reduce((sum, trade) => sum + trade.resultR, 0));
  const monthly = [...monthMap].map(([month, value]) => ({ month, value }));
  const ranked = [...monthly].sort((a, b) => a.value - b.value);
  const fingerprint = JSON.stringify({ rules, parameters });
  let hash = 2166136261;
  for (const char of fingerprint) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return {
    id: `${Date.now()}-${hash >>> 0}`, createdAt: new Date().toISOString(), dataSource: "uploaded",
    rules: { ...rules }, engineParameters: { ...parameters }, trades, totalR,
    averageR: trades.length ? totalR / trades.length : 0, winRate: trades.length ? wins / trades.length * 100 : 0,
    wins, losses: trades.length - wins, profitFactor: loss ? profit / loss : profit ? Infinity : 0,
    maxDrawdown, longestLosingStreak, equity, drawdown, monthly,
    bestMonth: ranked.at(-1) ?? null, worstMonth: ranked[0] ?? null,
  };
}

function daySignals(candles: Candle[], sweep: boolean) {
  const grouped = new Map<string, Candle[]>();
  candles.forEach((candle) => {
    const date = candle.timestamp.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), candle]);
  });
  const days = [...grouped.values()], signals: Signal[] = [];
  for (let dayIndex = 1; dayIndex < days.length; dayIndex += 1) {
    const previousHigh = Math.max(...days[dayIndex - 1].map((candle) => candle.high));
    const previousLow = Math.min(...days[dayIndex - 1].map((candle) => candle.low));
    for (const candle of days[dayIndex]) {
      const index = candles.indexOf(candle);
      if (sweep && candle.high > previousHigh && candle.close < previousHigh) { signals.push({ index, direction: "Short", entry: candle.close, stop: candle.high }); break; }
      if (sweep && candle.low < previousLow && candle.close > previousLow) { signals.push({ index, direction: "Long", entry: candle.close, stop: candle.low }); break; }
      if (!sweep && candle.high > previousHigh) { signals.push({ index, direction: "Long", entry: previousHigh, stop: previousLow }); break; }
      if (!sweep && candle.low < previousLow) { signals.push({ index, direction: "Short", entry: previousLow, stop: previousHigh }); break; }
    }
  }
  return signals;
}

function maSignals(candles: Candle[], parameters: EngineParameters, pullback: boolean) {
  const closes = candles.map((candle) => candle.close), signals: Signal[] = [];
  for (let index = parameters.slowMa; index < candles.length; index += 1) {
    const fast = sma(closes, parameters.fastMa, index), slow = sma(closes, parameters.slowMa, index);
    const previousFast = sma(closes, parameters.fastMa, index - 1), previousSlow = sma(closes, parameters.slowMa, index - 1);
    const longSignal = pullback ? fast > slow && candles[index].low <= fast && candles[index].close > fast : fast > slow && previousFast <= previousSlow;
    const shortSignal = pullback ? fast < slow && candles[index].high >= fast && candles[index].close < fast : fast < slow && previousFast >= previousSlow;
    if (longSignal) signals.push({ index, direction: "Long", entry: candles[index].close, stop: low(candles, index, parameters.stopLookback) });
    if (shortSignal) signals.push({ index, direction: "Short", entry: candles[index].close, stop: high(candles, index, parameters.stopLookback) });
  }
  return signals;
}

function rsiSignals(candles: Candle[], parameters: EngineParameters) {
  const values = rsi(candles.map((candle) => candle.close), parameters.rsiPeriod), signals: Signal[] = [];
  for (let index = parameters.rsiPeriod + 1; index < candles.length; index += 1) {
    if (values[index] > parameters.rsiOversold && values[index - 1] <= parameters.rsiOversold) signals.push({ index, direction: "Long", entry: candles[index].close, stop: low(candles, index, parameters.stopLookback) });
    if (values[index] < parameters.rsiOverbought && values[index - 1] >= parameters.rsiOverbought) signals.push({ index, direction: "Short", entry: candles[index].close, stop: high(candles, index, parameters.stopLookback) });
  }
  return signals;
}

function levelSignals(candles: Candle[], parameters: EngineParameters) {
  const signals: Signal[] = [];
  for (let index = parameters.lookback; index < candles.length; index += 1) {
    const history = candles.slice(index - parameters.lookback, index);
    const resistance = Math.max(...history.map((candle) => candle.high));
    const support = Math.min(...history.map((candle) => candle.low));
    if (candles[index].high > resistance) signals.push({ index, direction: "Long", entry: resistance, stop: low(candles, index, parameters.stopLookback) });
    else if (candles[index].low < support) signals.push({ index, direction: "Short", entry: support, stop: high(candles, index, parameters.stopLookback) });
  }
  return signals;
}

export function runRuleStrategy(rules: StrategyRules, candles: Candle[], parameters: EngineParameters = DEFAULT_ENGINE_PARAMETERS) {
  let signals: Signal[];
  switch (rules.strategyType) {
    case "previous_day_breakout": signals = daySignals(candles, false); break;
    case "previous_day_sweep": signals = daySignals(candles, true); break;
    case "moving_average_crossover": signals = maSignals(candles, parameters, false); break;
    case "moving_average_pullback": signals = maSignals(candles, parameters, true); break;
    case "rsi_reversal": signals = rsiSignals(candles, parameters); break;
    case "support_resistance_breakout": signals = levelSignals(candles, parameters); break;
    default: throw new Error(`Strategy engine "${rules.strategyType}" is not handled by runRuleStrategy.`);
  }
  return summarize(rules, execute(rules, candles, signals), parameters);
}
