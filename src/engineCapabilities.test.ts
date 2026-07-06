import { describe, expect, it } from "vitest";
import { classifyStrategy, hasServerEngine, STRATEGY_READINESS } from "./engineCapabilities";

describe("server engine capabilities", () => {
  it("marks implemented server strategies ready", () => {
    expect(classifyStrategy("opening_range_breakout")).toBe(STRATEGY_READINESS.READY_TO_BACKTEST);
    expect(classifyStrategy("previous_day_breakout")).toBe(STRATEGY_READINESS.READY_TO_BACKTEST);
    expect(hasServerEngine("previous_day_sweep")).toBe(true);
  });

  it("keeps objective but unimplemented strategies away from reports", () => {
    expect(classifyStrategy("rsi_reversal")).toBe(STRATEGY_READINESS.PARSED_BUT_UNSUPPORTED);
    expect(hasServerEngine("moving_average_crossover")).toBe(false);
  });

  it("classifies subjective conditions before engine availability", () => {
    expect(classifyStrategy("rsi_reversal", ["strong momentum"])).toBe(
      STRATEGY_READINESS.UNSUPPORTED_VAGUE_PROMPT
    );
  });
});
