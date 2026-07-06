import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SaaSWorkspace from "./SaaSWorkspace";

const account = {
  id: "user-1", email: "trader@example.com", displayName: "Test Trader", role: "user",
  plan: "free", subscriptionStatus: "active",
  usage: {
    limits: { backtests: 5, savedStrategies: 3, savedReports: 3, pineExports: 0 },
    used: { backtests: 1, pineExports: 0, transcriptExtractions: 0, comparisons: 0 }
  }
};
const response = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));
const csv = () => `timestamp,open,high,low,close
2026-01-05T08:00:00,100,101,99,100
2026-01-05T08:05:00,100,102,99.5,101
2026-01-05T08:10:00,101,103,100,102
2026-01-05T08:15:00,102,104,102,104
2026-01-05T08:20:00,104,112,103.5,111`;

describe("server-backed SaaS workspace", () => {
  beforeEach(() => { window.location.hash = "#/saas"; });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("registers an account and opens the workspace", async () => {
    let authenticated = false;
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return authenticated ? response(200, { account }) : response(401, { error: { code: "AUTH_REQUIRED", message: "Authentication required." } });
      if (path === "/api/auth/register" && init?.method === "POST") {
        authenticated = true;
        return response(201, { user: { id: account.id, email: account.email, displayName: account.displayName, plan: "free" } });
      }
      return response(404, { error: { message: "Not found" } });
    }));
    render(<SaaSWorkspace />);
    expect(await screen.findByText("Start with the free plan")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test Trader" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByText("Create account"));
    expect(await screen.findByText("Describe the strategy")).toBeTruthy();
    expect(screen.getByText("1/5")).toBeTruthy();
  });

  it("parses a prompt while exposing parser assumptions", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return response(200, { account });
      if (path === "/api/ai/parse-rules" && init?.method === "POST") return response(200, {
        parser: "deterministic-v1",
        rules: {
          name: "ES opening range breakout", strategyType: "opening_range_breakout", market: "Futures",
          symbol: "ES", timeframe: "5m", dateRange: "3y", sessionTime: "09:30", timezone: "America/New_York",
          openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
          rewardRisk: 2, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true
        },
        assumptions: ["Timeframe defaulted to 5-minute candles."],
        untestable: [], clarificationNeeded: true
      });
      return response(404, { error: { message: "Not found" } });
    }));
    render(<SaaSWorkspace />);
    await screen.findByText("Describe the strategy");
    fireEvent.click(screen.getByText("Preview extracted rules"));
    expect(await screen.findByText("Parser assumptions")).toBeTruthy();
    expect(screen.getByText("Timeframe defaulted to 5-minute candles.")).toBeTruthy();
    expect(screen.getByDisplayValue("ES opening range breakout")).toBeTruthy();
  });

  it("uploads candles and renders an honest server report", async () => {
    const serverReport = {
      id: "report-1", createdAt: new Date().toISOString(),
      rules: { name: "NQ 8:00 Opening Range", symbol: "NQ", timeframe: "5m", rewardRisk: 3 },
      result: {
        trades: [{ id: 1 }], totalR: -1.06, averageR: -1.06, winRate: 0,
        wins: 0, losses: 1, profitFactor: 0, maxDrawdown: 1.06,
        longestLosingStreak: 1, monthly: [], equity: [0, -1.06], drawdown: [0, -1.06]
      }
    };
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return response(200, { account });
      if (path === "/api/backtests/orb" && init?.method === "POST") return response(201, { cached: false, report: serverReport });
      return response(404, { error: { message: "Not found" } });
    }));
    const view = render(<SaaSWorkspace />);
    await screen.findByText("Market data is automatic");
    const file = new File([csv()], "nq.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(csv()) });
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(view.container.querySelector(".market-data-status em")?.textContent).toBe("nq.csv · 5 candles"));
    fireEvent.click(screen.getByText("Run exact rules"));
    expect(await screen.findByText("NEW SERVER REPORT")).toBeTruthy();
    expect(screen.getAllByText("-1.06R").length).toBeGreaterThan(0);
    expect(screen.getByText(/Past backtest results do not guarantee/)).toBeTruthy();
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([path]) => path === "/api/backtests/orb")).toBe(true));
  });
});


