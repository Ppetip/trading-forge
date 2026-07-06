export type Direction = "long_and_short" | "long_only" | "short_only";
export type StrategyType =
  | "opening_range_breakout"
  | "previous_day_breakout"
  | "previous_day_sweep"
  | "moving_average_crossover"
  | "moving_average_pullback"
  | "rsi_reversal"
  | "support_resistance_breakout";

export interface EngineParameterSnapshot {
  fastMa: number;
  slowMa: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  lookback: number;
  stopLookback: number;
}

export interface StrategyRules {
  name: string;
  strategyType: StrategyType;
  market: "Futures";
  symbol: string;
  timeframe: "1m" | "5m" | "15m";
  dateRange: "6m" | "1y" | "3y" | "5y";
  sessionTime: string;
  timezone: string;
  openingRangeMinutes: 5 | 15 | 30 | 60;
  entryRule: "break_above_or_below_range";
  stopRule: "opposite_side_of_range";
  rewardRisk: number;
  direction: Direction;
  maxTradesPerDay: number;
  fees: boolean;
  slippage: boolean;
}

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Trade {
  id: number;
  date: string;
  time: string;
  direction: "Long" | "Short";
  entry: number;
  stop: number;
  target: number;
  resultR: number;
  status: "Win" | "Loss";
}

export interface BacktestResult {
  id: string;
  createdAt: string;
  dataSource: "demo" | "uploaded";
  dataSourceLabel?: string;
  rules: StrategyRules;
  engineParameters?: EngineParameterSnapshot;
  trades: Trade[];
  totalR: number;
  averageR: number;
  winRate: number;
  wins: number;
  losses: number;
  profitFactor: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  equity: number[];
  drawdown: number[];
  monthly: { month: string; value: number }[];
  bestMonth: { month: string; value: number } | null;
  worstMonth: { month: string; value: number } | null;
}

export interface SavedStrategy {
  id: string;
  savedAt: string;
  favorite: boolean;
  rules: StrategyRules;
  engineParameters?: EngineParameterSnapshot;
  latestResult?: BacktestResult;
}

export interface UserPreferences {
  market: "Futures";
  symbol: string;
  timeframe: StrategyRules["timeframe"];
  dateRange: StrategyRules["dateRange"];
  rewardRisk: number;
  timezone: string;
  fees: boolean;
  slippage: boolean;
  chartStyle: "line" | "area";
  theme: "dark" | "light";
}
