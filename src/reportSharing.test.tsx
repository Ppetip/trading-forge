import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SaaSReports from "./SaaSReports";

const report = {
  id: "share-1", cacheKey: "1234567890abcdef", engineVersion: "orb-v1", visibility: "private",
  createdAt: "2026-07-04T12:00:00.000Z",
  rules: {
    name: "NQ Shared ORB", strategyType: "opening_range_breakout", market: "Futures", symbol: "NQ",
    timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
    openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
    rewardRisk: 3, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true
  },
  result: {
    trades: [], totalR: 0, averageR: 0, winRate: 0, wins: 0, losses: 0, profitFactor: null,
    maxDrawdown: 0, longestLosingStreak: 0, equity: [0], drawdown: [0], monthly: [],
    bestMonth: null, worstMonth: null
  }
};
const response = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" }
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("report sharing UI", () => {
  it("lets the report owner publish a private report", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/reports/share-1" && !init?.method) return response({ report });
      if (path === "/api/reports/share-1" && init?.method === "PATCH") return response({ report: { ...report, visibility: "public" } });
      return response({});
    }));
    render(<SaaSReports reportId="share-1" />);
    fireEvent.click(await screen.findByText("Make public"));
    expect(await screen.findByText("Public link enabled.")).toBeTruthy();
    expect(screen.getByText("Make private")).toBeTruthy();
    expect(screen.getByText("Copy link")).toBeTruthy();
  });

  it("loads a shared report without owner controls", async () => {
    const publicReport = { ...report, visibility: "public" };
    const fetchMock = vi.fn((path: string) => response(path === "/api/public/reports/share-1" ? { report: publicReport } : {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SaaSReports reportId="share-1" publicView />);
    expect(await screen.findByText("SHARED RESEARCH REPORT")).toBeTruthy();
    expect(screen.getByText(/shared historical backtest report/)).toBeTruthy();
    expect(screen.queryByText("Make private")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/reports/share-1", expect.anything());
  });
});
