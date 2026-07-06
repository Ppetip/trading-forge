import type { EngineParameters } from "./strategyEngines";
import type { StrategyRules } from "./types";

const title = (rules: StrategyRules) => rules.name.replaceAll('"', "'");
const header = (rules: StrategyRules) => `//@version=5
strategy("${title(rules)}", overlay=true, pyramiding=0, commission_type=strategy.commission.percent, commission_value=${rules.fees ? "0.01" : "0"})
rewardRisk = input.float(${rules.rewardRisk}, "Reward / risk")
`;
const exits = (rules: StrategyRules) => `
longAllowed = ${rules.direction !== "short_only"}
shortAllowed = ${rules.direction !== "long_only"}
if longSignal and longAllowed
    strategy.entry("Long", strategy.long)
    strategy.exit("Long exit", "Long", stop=longStop, limit=close + (close - longStop) * rewardRisk)
if shortSignal and shortAllowed
    strategy.entry("Short", strategy.short)
    strategy.exit("Short exit", "Short", stop=shortStop, limit=close - (shortStop - close) * rewardRisk)
`;

export function generateStrategyPine(rules: StrategyRules, parameters: EngineParameters) {
  let body = "";
  switch (rules.strategyType) {
    case "previous_day_breakout":
      body = `previousHigh = request.security(syminfo.tickerid, "D", high[1], lookahead=barmerge.lookahead_on)
previousLow = request.security(syminfo.tickerid, "D", low[1], lookahead=barmerge.lookahead_on)
longSignal = ta.crossover(high, previousHigh)
shortSignal = ta.crossunder(low, previousLow)
longStop = previousLow
shortStop = previousHigh
`; break;
    case "previous_day_sweep":
      body = `previousHigh = request.security(syminfo.tickerid, "D", high[1], lookahead=barmerge.lookahead_on)
previousLow = request.security(syminfo.tickerid, "D", low[1], lookahead=barmerge.lookahead_on)
longSignal = low < previousLow and close > previousLow
shortSignal = high > previousHigh and close < previousHigh
longStop = low
shortStop = high
`; break;
    case "moving_average_crossover":
      body = `fastLength = input.int(${parameters.fastMa}, "Fast MA")
slowLength = input.int(${parameters.slowMa}, "Slow MA")
stopLookback = input.int(${parameters.stopLookback}, "Stop lookback")
fast = ta.sma(close, fastLength)
slow = ta.sma(close, slowLength)
longSignal = ta.crossover(fast, slow)
shortSignal = ta.crossunder(fast, slow)
longStop = ta.lowest(low, stopLookback)
shortStop = ta.highest(high, stopLookback)
plot(fast, color=color.teal)
plot(slow, color=color.gray)
`; break;
    case "moving_average_pullback":
      body = `fastLength = input.int(${parameters.fastMa}, "Fast MA")
slowLength = input.int(${parameters.slowMa}, "Slow MA")
stopLookback = input.int(${parameters.stopLookback}, "Stop lookback")
fast = ta.sma(close, fastLength)
slow = ta.sma(close, slowLength)
longSignal = fast > slow and low <= fast and close > fast
shortSignal = fast < slow and high >= fast and close < fast
longStop = ta.lowest(low, stopLookback)
shortStop = ta.highest(high, stopLookback)
plot(fast, color=color.teal)
plot(slow, color=color.gray)
`; break;
    case "rsi_reversal":
      body = `rsiPeriod = input.int(${parameters.rsiPeriod}, "RSI period")
oversold = input.float(${parameters.rsiOversold}, "Oversold")
overbought = input.float(${parameters.rsiOverbought}, "Overbought")
stopLookback = input.int(${parameters.stopLookback}, "Stop lookback")
rsiValue = ta.rsi(close, rsiPeriod)
longSignal = ta.crossover(rsiValue, oversold)
shortSignal = ta.crossunder(rsiValue, overbought)
longStop = ta.lowest(low, stopLookback)
shortStop = ta.highest(high, stopLookback)
`; break;
    case "support_resistance_breakout":
      body = `lookback = input.int(${parameters.lookback}, "Level lookback")
stopLookback = input.int(${parameters.stopLookback}, "Stop lookback")
resistance = ta.highest(high[1], lookback)
support = ta.lowest(low[1], lookback)
longSignal = ta.crossover(high, resistance)
shortSignal = ta.crossunder(low, support)
longStop = ta.lowest(low, stopLookback)
shortStop = ta.highest(high, stopLookback)
plot(resistance, color=color.new(color.teal, 40))
plot(support, color=color.new(color.red, 40))
`; break;
    default:
      throw new Error("ORB export uses the session-aware Pine generator.");
  }
  return `${header(rules)}
// Generated from frozen EdgeLab rules.
// Verify data, timezone, session, fees, slippage, and fill behavior in TradingView.
${body}${exits(rules)}`;
}
