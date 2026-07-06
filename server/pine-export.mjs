export function generateOrbPine(rules) {
  const name = String(rules.name ?? "EdgeLab ORB").replaceAll('"', "'");
  const session = String(rules.sessionTime ?? "08:00").replace(":", "");
  const timezone = String(rules.timezone ?? "America/New_York").replaceAll('"', "");
  const commission = rules.fees ? "0.01" : "0";
  return `//@version=5
strategy("${name}", overlay=true, pyramiding=0, commission_type=strategy.commission.percent, commission_value=${commission})

// Generated from a saved EdgeLab report.
// TradingView results may differ due to data, sessions, fees, slippage, and fill rules.
orbMinutes = input.int(${Number(rules.openingRangeMinutes ?? 15)}, "Opening range minutes")
rewardRisk = input.float(${Number(rules.rewardRisk ?? 3)}, "Reward / risk")
sessionStart = input.session("${session}-${session}", "Session start")
newSession = not na(time(timeframe.period, sessionStart, "${timezone}"))
var float rangeHigh = na
var float rangeLow = na
var int sessionBar = 0

if newSession and not newSession[1]
    rangeHigh := high
    rangeLow := low
    sessionBar := 1
else if sessionBar > 0 and sessionBar * timeframe.multiplier < orbMinutes
    rangeHigh := math.max(rangeHigh, high)
    rangeLow := math.min(rangeLow, low)
    sessionBar += 1

rangeReady = sessionBar * timeframe.multiplier >= orbMinutes
risk = rangeHigh - rangeLow
longAllowed = ${rules.direction !== "short_only"}
shortAllowed = ${rules.direction !== "long_only"}
longSignal = rangeReady and ta.crossover(high, rangeHigh) and longAllowed
shortSignal = rangeReady and ta.crossunder(low, rangeLow) and shortAllowed

if longSignal
    strategy.entry("Long", strategy.long)
    strategy.exit("Long exit", "Long", stop=rangeLow, limit=rangeHigh + risk * rewardRisk)
if shortSignal
    strategy.entry("Short", strategy.short)
    strategy.exit("Short exit", "Short", stop=rangeHigh, limit=rangeLow - risk * rewardRisk)
`;
}
