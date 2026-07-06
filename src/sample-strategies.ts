export type SampleStrategy = {
  id: string;
  name: string;
  concept: string;
  pack: "famous-inspired" | "common";
  engine: "available" | "roadmap";
};

const inspiredNames = [
  ["turtle-breakout", "Turtle-style breakout", "Break a multi-day price channel and exit on a shorter opposing channel."],
  ["darvas-box", "Darvas box breakout", "Enter when price clears a defined consolidation box."],
  ["can-slim", "CAN SLIM-style momentum screen", "Screen for earnings and price momentum before a breakout."],
  ["trend-ma", "Trend-following moving average system", "Follow the dominant trend using moving-average state."],
  ["mean-reversion-band", "Mean reversion band system", "Fade statistically extended moves toward a center band."],
  ["opening-range", "Opening range breakout", "Trade a confirmed break of the session opening range."],
  ["london-breakout", "London breakout", "Trade expansion from the pre-London session range."],
  ["gap-go", "Gap-and-go style setup", "Continue with a strong opening gap after confirmation."],
  ["ma-pullback", "Pullback to moving average", "Enter a trend after price retraces to a moving average."],
  ["breakout-retest", "Breakout retest setup", "Wait for a broken level to hold before entry."],
  ["volatility-contraction", "Volatility contraction breakout", "Trade expansion after narrowing ranges and volatility."],
  ["pdh-breakout", "Previous day high/low breakout", "Trade a break beyond the prior session extreme."],
  ["liquidity-sweep", "Liquidity sweep reversal", "Fade a failed break through a prior reference level."],
  ["range-expansion", "Range expansion breakout", "Enter when current range exceeds a defined baseline."],
  ["momentum-continuation", "Simple momentum continuation", "Continue in the direction of confirmed short-term momentum."]
] as const;

const commonNames = [
  ["8am-orb", "8 AM ORB", "NQ 15-minute opening range beginning at 8:00 AM New York time."],
  ["930-orb", "9:30 AM ORB", "Trade a break of the first 15 minutes of the cash session."],
  ["pdh-long", "Previous day high breakout", "Enter long when price confirms above the prior-day high."],
  ["pdl-short", "Previous day low breakdown", "Enter short when price confirms below the prior-day low."],
  ["pdh-sweep", "Previous day high sweep reversal", "Short after a failed break above the prior-day high."],
  ["pdl-sweep", "Previous day low sweep reversal", "Buy after a failed break below the prior-day low."],
  ["rsi-bounce", "RSI oversold bounce", "Buy after RSI recovers from an oversold threshold."],
  ["rsi-short", "RSI overbought short", "Short after RSI falls from an overbought threshold."],
  ["ema-cross", "EMA crossover", "Trade when a fast EMA crosses a slower EMA."],
  ["vwap-reclaim", "VWAP reclaim", "Enter long after price regains and holds VWAP."],
  ["vwap-rejection", "VWAP rejection", "Enter after price tests and rejects VWAP."],
  ["support-breakout", "Support breakout", "Trade a confirmed break below a defined support level."],
  ["resistance-breakout", "Resistance breakout", "Trade a confirmed break above a defined resistance level."],
  ["inside-bar", "Inside bar breakout", "Trade a break of the prior inside-bar range."],
  ["gap-fill", "Gap fill strategy", "Trade toward the prior close after an opening gap."]
] as const;

const make = (pack: SampleStrategy["pack"], rows: readonly (readonly [string, string, string])[]): SampleStrategy[] =>
  rows.map(([id, name, concept]) => ({
    id, name, concept, pack,
    engine: id === "opening-range" || id === "8am-orb" || id === "930-orb" ? "available" : "roadmap"
  }));

export const SAMPLE_STRATEGIES = [
  ...make("famous-inspired", inspiredNames),
  ...make("common", commonNames)
];
