import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SaaSReports from "./SaaSReports";

const report = {
  id: "report-1",
  cacheKey: "abc123def456789",
  engineVersion: "orb-v1",
  visibility: "private",
  createdAt: "2026-07-04T12:00:00.000Z",
  rules: {
    name: "NQ 8 AM ORB",
    strategyType: "opening_range_breakout",
    market: "Futures",
    symbol: "NQ",
    timeframe: "5m",
    dateRange: "3y",
    sessionTime: "08:00",
    timezone: "America/New_York",
    openingRangeMinutes: 15,
    entryRule: "break_above_or_below_range",
    stopRule: "opposite_side_of_range",
    rewardRisk: 3,
    direction: "long_and_short",
    maxTradesPerDay: 1,
    fees: true,
    slippage: true
  },
  result: {
    trades: [{ id: 1, date: "2026-01-05", time: "08:15", direction: "long", entry: 100, stop: 99, target: 103, resultR: 3, status: "win" }],
    totalR: 3,
    averageR: 3,
    winRate: 100,
    wins: 1,
    losses: 0,
    profitFactor: null,
    maxDrawdown: 0,
    longestLosingStreak: 0,
    equity: [0, 3],
    drawdown: [0, 0],
    monthly: [{ month: "2026-01", value: 3 }],
    bestMonth: { month: "2026-01", value: 3 },
    worstMonth: { month: "2026-01", value: 3 }
  }
};

const response = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" }
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server report pages", () => {
  it("lists saved reports with their immutable result summary", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ reports: [report] })));
    render(<SaaSReports />);
    expect(await screen.findByText("NQ 8 AM ORB")).toBeTruthy();
    expect(screen.getAllByText("+3.00R").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(await screen.findByText("Saved backtest reports")).toBeTruthy();
    expect(screen.getByText("Unverified legacy reports")).toBeTruthy();
    expect(screen.getByText(/1 trades/)).toBeTruthy();
  });

  it("renders exact rules, warnings, charts, and the trade log", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ report })));
    const view = render(<SaaSReports reportId="report-1" />);
    expect(await screen.findByText("Exact tested rules")).toBeTruthy();
    expect(screen.getByText("Small sample warning.")).toBeTruthy();
    expect(screen.getByText("Trade log")).toBeTruthy();
    expect(screen.getByText("Trade tape debug view")).toBeTruthy();
    expect(screen.getAllByText("orb-v1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("long").length).toBeGreaterThan(0);
    expect(view.container.querySelectorAll(".saas-report-chart")).toHaveLength(2);
    expect(view.container.querySelector("pre")?.textContent).toContain('"same_bar_policy": "stop_first"');
  });
});



