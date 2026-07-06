import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SaaSReports from "./SaaSReports";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows daily-level rules without presenting ORB-only fields as tested", async () => {
  const report = {
    id: "daily-1", cacheKey: "abcdef123456789", engineVersion: "daily-level-1.0.0", visibility: "private",
    createdAt: "2026-07-04T12:00:00.000Z",
    rules: {
      name: "NQ previous day sweep", strategyType: "previous_day_sweep", market: "Futures", symbol: "NQ",
      timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
      openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
      rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true
    },
    result: {
      trades: [], totalR: 0, averageR: 0, winRate: 0, wins: 0, losses: 0, profitFactor: 0,
      maxDrawdown: 0, longestLosingStreak: 0, equity: [0], drawdown: [0], monthly: [],
      bestMonth: null, worstMonth: null
    }
  };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ report }), {
    status: 200, headers: { "content-type": "application/json" }
  }))));
  const view = render(<SaaSReports reportId="daily-1" />);
  await screen.findByText("Exact tested rules");
  const snapshot = view.container.querySelector("pre")?.textContent ?? "";
  expect(snapshot).toContain('"entry_rule": "pierce_level_then_close_back_inside"');
  expect(snapshot).toContain('"reference": "previous_trading_date_high_low"');
  expect(snapshot).not.toContain("opening_range_minutes");
  expect(snapshot).not.toContain("session_time");
});
