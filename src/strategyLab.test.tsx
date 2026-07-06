import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Root from "./Root";
import StrategyLab from "./StrategyLab";
import { generateStrategyPine } from "./pineStrategies";
import { DEFAULT_ENGINE_PARAMETERS } from "./strategyEngines";
import type { StrategyRules, StrategyType } from "./types";

const rules: StrategyRules = {
  name: "Export test", strategyType: "moving_average_crossover", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 3, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true,
};

afterEach(cleanup);

describe("multi-strategy workspace", () => {
  it("routes to the engine lab and keeps backtesting gated on candle data", () => {
    window.location.hash = "#/strategy-lab";
    render(<Root />);
    expect(screen.getByText("Rule engine lab")).toBeTruthy();
    expect(screen.getByText("Exact rules")).toBeTruthy();
    fireEvent.click(screen.getByText("Run backtest"));
    expect(screen.getByText("Upload historical OHLC candles before running this workspace.")).toBeTruthy();
  });

  it("reveals engine-specific parameters in the form and exact rules", () => {
    render(<StrategyLab />);
    fireEvent.click(screen.getByText("Moving average crossover"));
    expect(screen.getByLabelText("Fast MA")).toBeTruthy();
    expect(screen.getByLabelText("Slow MA")).toBeTruthy();
    expect(screen.getByText(/"fast_ma": 9/)).toBeTruthy();
    fireEvent.click(screen.getByText("RSI reversal"));
    expect(screen.getByLabelText("RSI period")).toBeTruthy();
    expect(screen.getByLabelText("Oversold")).toBeTruthy();
    expect(screen.getByLabelText("Overbought")).toBeTruthy();
  });

  it.each([
    "previous_day_breakout", "previous_day_sweep", "moving_average_crossover",
    "moving_average_pullback", "rsi_reversal", "support_resistance_breakout",
  ] as StrategyType[])("generates Pine for %s from frozen parameters", (strategyType) => {
    const script = generateStrategyPine({ ...rules, strategyType }, DEFAULT_ENGINE_PARAMETERS);
    expect(script).toContain("//@version=5");
    expect(script).toContain('strategy("Export test"');
    expect(script).toContain("rewardRisk");
    expect(script).toContain("longSignal");
    expect(script).toContain("shortSignal");
  });
});
