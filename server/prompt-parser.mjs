const SYMBOLS = ["NQ", "ES", "YM", "RTY", "CL", "GC", "6E", "BTC", "ETH", "SPY", "QQQ"];

export function parseStrategyPrompt(prompt, defaults = {}) {
  const text = String(prompt ?? "").trim();
  if (text.length < 10) throw new Error("Describe the strategy in at least 10 characters.");
  const lower = text.toLowerCase();
  const symbol = SYMBOLS.find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(text)) ?? defaults.symbol ?? "NQ";
  const timeframe = lower.match(/\b(1|5|15)\s*(?:m|min|minute)/)?.[1];
  const range = lower.match(/\b(5|15|30|60)\s*(?:m|min|minute)(?:ute)?\s+(?:opening\s+)?range/)?.[1] ??
    lower.match(/(?:opening\s+range|orb)\D{0,12}(5|15|30|60)/)?.[1];
  const rewardRisk = lower.match(/1\s*[:/]\s*(\d+(?:\.\d+)?)/)?.[1] ?? lower.match(/(\d+(?:\.\d+)?)\s*r\b/)?.[1];
  const session = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  let sessionTime = defaults.sessionTime ?? "09:30";
  if (session) {
    let hour = Number(session[1]) % 12;
    if (session[3] === "pm") hour += 12;
    sessionTime = `${String(hour).padStart(2, "0")}:${session[2] ?? "00"}`;
  }
  const years = lower.match(/\b(\d+)\s*years?\b/)?.[1];
  const months = lower.match(/\b(\d+)\s*months?\b/)?.[1];
  const days = lower.match(/\b(\d+)\s*days?\b/)?.[1];
  const dateRange = years
    ? (Number(years) > 1 ? `${Math.min(5, Number(years))}y` : "1y")
    : months
      ? (Number(months) <= 6 ? "6m" : "1y")
      : days
        ? (Number(days) <= 30 ? "30d" : Number(days) <= 60 ? "60d" : "6m")
        : "30d";
  const namedDays = [["monday", "Monday"], ["tuesday", "Tuesday"], ["wednesday", "Wednesday"], ["thursday", "Thursday"], ["friday", "Friday"]].filter(([key]) => lower.includes(key)).map(([, label]) => label);
  const assumptions = [];
  if (!timeframe) assumptions.push("Timeframe defaulted to 15-minute candles.");
  if (!range) assumptions.push("Opening range defaulted to 15 minutes.");
  if (!rewardRisk) assumptions.push("Reward/risk defaulted to 1:2.");
  if (!session) assumptions.push("Session start defaulted to 09:30 America/New_York.");
  if (!years && !months && !days) assumptions.push("Historical intraday window defaulted to the latest 30 days so it fits research-grade data limits.");
  if (!namedDays.length) assumptions.push("Test includes every eligible Monday through Friday; no weekday filter was requested.");
  const strategyType = lower.includes("opening range") || /\borb\b/.test(lower)
    ? "opening_range_breakout"
    : lower.includes("previous day") && (lower.includes("sweep") || lower.includes("liquidity"))
      ? "previous_day_sweep"
      : lower.includes("previous day")
        ? "previous_day_breakout"
        : lower.includes("rsi")
          ? "rsi_reversal"
          : lower.includes("moving average") || lower.includes("ema") || lower.includes("sma")
            ? "moving_average_crossover"
            : "opening_range_breakout";
  return {
    parser: "deterministic-v1",
    rules: {
      name: `${symbol} ${strategyType.replaceAll("_", " ")}`,
      strategyType,
      market: defaults.market ?? "Futures",
      symbol,
      timeframe: `${timeframe ?? "15"}m`,
      dateRange,
      sessionTime,
      timezone: defaults.timezone ?? "America/New_York",
      openingRangeMinutes: Number(range ?? 15),
      entryRule: "break_above_or_below_range",
      stopRule: "opposite_side_of_range",
      rewardRisk: Number(rewardRisk ?? 2),
      direction: lower.includes("long only") ? "long_only" : lower.includes("short only") ? "short_only" : "long_and_short",
      maxTradesPerDay: 1,
      researchGoal: "Validate the stated rules across historical market conditions",
      contractSelection: "continuous_front_contract",
      tradingDays: namedDays.length ? namedDays : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      entryConfirmation: "candle_close",
      lookbackPolicy: years || months || days ? "user_specified" : "default_30_days",
      fees: true,
      slippage: true,
      ...(strategyType === "rsi_reversal" ? {
        indicator: lower.includes("bollinger") ? "bollinger_rsi_confluence" : "rsi",
        rsiPeriod: Number(lower.match(/(\d+)\s*-?period\s+rsi/)?.[1] ?? 14),
        rsiOversold: Number(lower.match(/rsi\s+(?:is\s+)?below\s+(\d+)/)?.[1] ?? 30),
        rsiOverbought: Number(lower.match(/rsi\s+(?:is\s+)?above\s+(\d+)/)?.[1] ?? 70),
        bollingerPeriod: Number(lower.match(/bollinger.{0,20}\((\d+)/)?.[1] ?? 20),
        bollingerStdDev: Number(lower.match(/bollinger.{0,30}\d+\s*(?:period)?\s*,\s*(\d+(?:\.\d+)?)/)?.[1] ?? 2),
        stopAtrMultiple: Number(lower.match(/(\d+(?:\.\d+)?)\s*(?:x|\\times|times)?.{0,12}atr/)?.[1] ?? 1.5),
        entryConfirmation: lower.includes("closes below") || lower.includes("closes above") ? "candle_close" : "unspecified",
        exitRule: lower.includes("moving average") ? "bollinger_middle_band_cross" : "unspecified"
      } : {})
    },
    assumptions,
    untestable: lower.includes("discretion") || lower.includes("looks strong")
      ? ["Discretionary language must be replaced with objective conditions."]
      : [],
    clarificationNeeded: assumptions.length > 0
  };
}



