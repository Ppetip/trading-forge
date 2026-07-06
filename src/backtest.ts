import type { BacktestResult, Candle, StrategyRules, Trade } from "./types";

function hashRules(rules: StrategyRules) {
  let hash = 2166136261;
  for (const char of JSON.stringify(rules)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function summarize(rules: StrategyRules, trades: Trade[], dataSource: BacktestResult["dataSource"]): BacktestResult {
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let longestLosingStreak = 0;
  const equity = [0];
  const drawdown = [0];
  const months = new Map<string, number>();
  for (const trade of trades) {
    running += trade.resultR;
    peak = Math.max(peak, running);
    const currentDrawdown = peak - running;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    streak = trade.resultR < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
    equity.push(running);
    drawdown.push(-currentDrawdown);
    const month = trade.date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + trade.resultR);
  }
  const wins = trades.filter((trade) => trade.status === "Win").length;
  const losses = trades.length - wins;
  const grossProfit = trades.filter((trade) => trade.resultR > 0).reduce((sum, trade) => sum + trade.resultR, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.resultR < 0).reduce((sum, trade) => sum + trade.resultR, 0));
  const monthly = [...months.entries()].map(([month, value]) => ({ month, value }));
  const ranked = [...monthly].sort((a, b) => a.value - b.value);
  return {
    id: `${Date.now()}-${hashRules(rules)}`,
    createdAt: new Date().toISOString(),
    dataSource,
    rules: { ...rules },
    trades,
    totalR: running,
    averageR: trades.length ? running / trades.length : 0,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    wins,
    losses,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    maxDrawdown,
    longestLosingStreak,
    equity,
    drawdown,
    monthly,
    bestMonth: ranked.at(-1) ?? null,
    worstMonth: ranked[0] ?? null,
  };
}

export function runDemoBacktest(rules: StrategyRules): BacktestResult {
  const random = seededRandom(hashRules(rules));
  const years = { "30d": 30 / 365, "60d": 60 / 365, "6m": 0.5, "1y": 1, "3y": 3, "5y": 5 }[rules.dateRange];
  const count = Math.round((48 + random() * 12) * years);
  const baseWinRate = Math.min(0.64, Math.max(0.2, 1 / (rules.rewardRisk + 0.72) + 0.08));
  const drag = (rules.fees ? 0.025 : 0) + (rules.slippage ? 0.035 : 0);
  const start = new Date("2023-01-03T13:30:00Z");
  const trades = Array.from({ length: count }, (_, index): Trade => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + Math.floor(index * (365 * years) / count));
    const direction = random() > 0.48 ? "Long" : "Short";
    const entry = 14500 + random() * 3400;
    const risk = 18 + random() * 42;
    const won = random() < baseWinRate;
    return {
      id: index + 1,
      date: date.toISOString().slice(0, 10),
      time: rules.sessionTime,
      direction,
      entry,
      stop: direction === "Long" ? entry - risk : entry + risk,
      target: direction === "Long" ? entry + risk * rules.rewardRisk : entry - risk * rules.rewardRisk,
      resultR: won ? rules.rewardRisk - drag : -1 - drag,
      status: won ? "Win" : "Loss",
    };
  });
  return summarize(rules, trades, "demo");
}

export function parseCandleCsv(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must include a header and candle rows.");
  const headers = lines[0].toLowerCase().split(",").map((value) => value.trim());
  const find = (names: string[]) => names.map((name) => headers.indexOf(name)).find((value) => value >= 0) ?? -1;
  const positions = [find(["timestamp", "datetime", "date"]), find(["open"]), find(["high"]), find(["low"]), find(["close"])];
  if (positions.includes(-1)) throw new Error("CSV headers must include timestamp, open, high, low, and close.");
  return lines.slice(1).map((line, row) => {
    const cells = line.split(",").map((value) => value.trim());
    const [timestampIndex, openIndex, highIndex, lowIndex, closeIndex] = positions;
    const candle: Candle = {
      timestamp: cells[timestampIndex],
      open: Number(cells[openIndex]),
      high: Number(cells[highIndex]),
      low: Number(cells[lowIndex]),
      close: Number(cells[closeIndex]),
    };
    if (!candle.timestamp || [candle.open, candle.high, candle.low, candle.close].some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid candle on CSV row ${row + 2}.`);
    }
    return candle;
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function runOrbBacktest(rules: StrategyRules, candles: Candle[]): BacktestResult {
  const days = new Map<string, Candle[]>();
  for (const candle of candles) {
    const date = candle.timestamp.slice(0, 10);
    days.set(date, [...(days.get(date) ?? []), candle]);
  }
  const trades: Trade[] = [];
  for (const [date, day] of days) {
    const start = day.findIndex((candle) => candle.timestamp.slice(11, 16) >= rules.sessionTime);
    const rangeBars = Math.max(1, Math.ceil(rules.openingRangeMinutes / Number.parseInt(rules.timeframe, 10)));
    if (start < 0 || day.length < start + rangeBars + 1) continue;
    const range = day.slice(start, start + rangeBars);
    const high = Math.max(...range.map((candle) => candle.high));
    const low = Math.min(...range.map((candle) => candle.low));
    const risk = high - low;
    if (risk <= 0) continue;
    const after = day.slice(start + rangeBars);
    const entryIndex = after.findIndex((candle) =>
      (rules.direction !== "short_only" && candle.high > high) ||
      (rules.direction !== "long_only" && candle.low < low));
    if (entryIndex < 0) continue;
    const entryCandle = after[entryIndex];
    const long = rules.direction !== "short_only" && entryCandle.high > high;
    const entry = long ? high : low;
    const stop = long ? low : high;
    const target = long ? entry + risk * rules.rewardRisk : entry - risk * rules.rewardRisk;
    let won = false;
    for (const candle of after.slice(entryIndex)) {
      const stopped = long ? candle.low <= stop : candle.high >= stop;
      const targeted = long ? candle.high >= target : candle.low <= target;
      if (stopped || targeted) {
        won = targeted && !stopped;
        break;
      }
    }
    const drag = (rules.fees ? 0.025 : 0) + (rules.slippage ? 0.035 : 0);
    trades.push({
      id: trades.length + 1,
      date,
      time: entryCandle.timestamp.slice(11, 16),
      direction: long ? "Long" : "Short",
      entry,
      stop,
      target,
      resultR: won ? rules.rewardRisk - drag : -1 - drag,
      status: won ? "Win" : "Loss",
    });
  }
  return summarize(rules, trades, "uploaded");
}
