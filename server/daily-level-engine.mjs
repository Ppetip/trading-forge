export const DAILY_LEVEL_ENGINE_VERSION = "daily-level-1.0.0";

function validate(rules, candles) {
  if (!["previous_day_breakout", "previous_day_sweep"].includes(rules?.strategyType)) throw new Error("Unsupported daily-level strategy.");
  if (!["long_and_short", "long_only", "short_only"].includes(rules.direction)) throw new Error("Unsupported direction.");
  if (!Number.isFinite(Number(rules.rewardRisk)) || Number(rules.rewardRisk) < 0.25 || Number(rules.rewardRisk) > 20) throw new Error("Reward/risk must be between 0.25 and 20.");
  if (!Number.isInteger(Number(rules.maxTradesPerDay)) || Number(rules.maxTradesPerDay) < 1) throw new Error("Maximum trades per day must be at least one.");
  if (!Array.isArray(candles) || candles.length < 3) throw new Error("At least three candles across two sessions are required.");
  for (const [index, candle] of candles.entries()) {
    if (!candle.timestamp || !Number.isFinite(candle.open) || !Number.isFinite(candle.high) || !Number.isFinite(candle.low) || !Number.isFinite(candle.close)) throw new Error(`Invalid candle at index ${index}.`);
    if (candle.high < candle.low || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) throw new Error(`Impossible OHLC candle at index ${index}.`);
  }
}

const allowed = (rules, direction) =>
  rules.direction === "long_and_short" ||
  rules.direction === "long_only" && direction === "Long" ||
  rules.direction === "short_only" && direction === "Short";

function summarize(rules, trades) {
  let totalR = 0, peak = 0, maxDrawdown = 0, streak = 0, longestLosingStreak = 0;
  const equity = [0], drawdown = [0], monthMap = new Map();
  for (const trade of trades) {
    totalR += trade.resultR;
    peak = Math.max(peak, totalR);
    const currentDrawdown = peak - totalR;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    streak = trade.resultR < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
    equity.push(totalR);
    drawdown.push(-currentDrawdown);
    const month = trade.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + trade.resultR);
  }
  const wins = trades.filter((trade) => trade.status === "Win").length;
  const profit = trades.filter((trade) => trade.resultR > 0).reduce((sum, trade) => sum + trade.resultR, 0);
  const loss = Math.abs(trades.filter((trade) => trade.resultR < 0).reduce((sum, trade) => sum + trade.resultR, 0));
  const monthly = [...monthMap].map(([month, value]) => ({ month, value }));
  const ranked = [...monthly].sort((a, b) => a.value - b.value);
  return {
    dataSource: "server", engineVersion: DAILY_LEVEL_ENGINE_VERSION, rules, trades, totalR,
    averageR: trades.length ? totalR / trades.length : 0,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    wins, losses: trades.length - wins,
    profitFactor: loss ? profit / loss : profit ? null : 0,
    maxDrawdown, longestLosingStreak, equity, drawdown, monthly,
    bestMonth: ranked.at(-1) ?? null, worstMonth: ranked[0] ?? null
  };
}

export function runDailyLevelBacktest(rules, sourceCandles) {
  validate(rules, sourceCandles);
  const candles = [...sourceCandles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const groups = new Map();
  candles.forEach((candle, index) => {
    const date = candle.timestamp.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), { candle, index }]);
  });
  const days = [...groups.entries()];
  const signals = [];
  for (let dayIndex = 1; dayIndex < days.length; dayIndex += 1) {
    const [, previous] = days[dayIndex - 1], [, current] = days[dayIndex];
    const previousHigh = Math.max(...previous.map(({ candle }) => candle.high));
    const previousLow = Math.min(...previous.map(({ candle }) => candle.low));
    for (const { candle, index } of current) {
      if (rules.strategyType === "previous_day_sweep" && candle.high > previousHigh && candle.close < previousHigh) {
        signals.push({ index, direction: "Short", entry: candle.close, stop: candle.high }); break;
      }
      if (rules.strategyType === "previous_day_sweep" && candle.low < previousLow && candle.close > previousLow) {
        signals.push({ index, direction: "Long", entry: candle.close, stop: candle.low }); break;
      }
      if (rules.strategyType === "previous_day_breakout" && candle.high > previousHigh) {
        signals.push({ index, direction: "Long", entry: previousHigh, stop: previousLow }); break;
      }
      if (rules.strategyType === "previous_day_breakout" && candle.low < previousLow) {
        signals.push({ index, direction: "Short", entry: previousLow, stop: previousHigh }); break;
      }
    }
  }
  const trades = [], dailyCount = new Map();
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
      entry: signal.entry, stop: signal.stop, target,
      resultR: won ? rules.rewardRisk - drag : -1 - drag,
      status: won ? "Win" : "Loss"
    });
    dailyCount.set(date, (dailyCount.get(date) ?? 0) + 1);
    blockedUntil = exitIndex;
  }
  return summarize(rules, trades);
}
