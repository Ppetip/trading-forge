import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminDashboard from "./AdminDashboard";
import TranscriptBuilder from "./TranscriptBuilder";

const response = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));
const account = (plan: "free" | "trial") => ({
  id: "u1", email: "trader@example.com", displayName: "Trader", role: "user", plan,
  subscriptionStatus: plan === "trial" ? "trialing" : "active",
  usage: {
    limits: { backtests: 50, savedStrategies: 25, savedReports: 50, pineExports: 20, transcriptExtractions: plan === "free" ? 0 : 5, comparisons: 20 },
    used: { backtests: 0, pineExports: 0, transcriptExtractions: 0, comparisons: 0 }
  }
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("transcript and admin operations", () => {
  it("explains why transcript extraction is unavailable on free", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/account") return response(200, { account: account("free") });
      if (path === "/api/transcripts") return response(200, { sources: [] });
      return response(404, { error: { message: "Not found" } });
    }));
    render(<TranscriptBuilder />);
    expect(await screen.findByText("Trial or Pro required")).toBeTruthy();
    expect(screen.getByText("0/0 extractions this month")).toBeTruthy();
    const button = screen.getByText("Extract candidate rules").closest("button");
    expect(button?.disabled).toBe(false);
    fireEvent.click(button!);
    expect(await screen.findByText("Transcript extraction is a paid research tool")).toBeTruthy();
  });

  it("extracts candidate rules while separating them from performance results", async () => {
    const source = {
      id: "t1", title: "ORB notes", sourceType: "trading_notes", sourceUrl: null,
      content: "Trade the NQ opening range breakout at 8 AM and use 1:3 risk reward.",
      status: "extracted", createdAt: "2026-07-04T12:00:00.000Z",
      extraction: {
        parser: "deterministic-v1", summary: "ORB notes",
        rules: { strategyType: "opening_range_breakout", symbol: "NQ", rewardRisk: 3 },
        assumptions: ["Timeframe defaulted to 5-minute candles."], untestable: [],
        clarificationNeeded: true, warning: "Review every rule and assumption before testing."
      }
    };
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return response(200, { account: account("trial") });
      if (path === "/api/transcripts" && init?.method === "POST") return response(201, { source });
      if (path === "/api/transcripts") return response(200, { sources: [] });
      return response(404, { error: { message: "Not found" } });
    }));
    render(<TranscriptBuilder />);
    await screen.findByText("Transcript-to-strategy");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "ORB notes" } });
    fireEvent.change(screen.getByLabelText("Transcript or notes"), { target: { value: source.content } });
    fireEvent.click(screen.getByText("Extract candidate rules"));
    expect(await screen.findByText("Candidate rules")).toBeTruthy();
    expect(screen.getByText("Timeframe defaulted to 5-minute candles.")).toBeTruthy();
    expect(screen.getByText(/contains no performance results/)).toBeTruthy();
  });

  it("renders the complete admin operations metrics", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(200, { metrics: {
      generatedAt: "2026-07-04T12:00:00.000Z",
      users: { total: 20, newSignups30d: 5, free: 12, trial: 3, paid: 5, conversionRate: .25, churnRate: .1 },
      activity: { backtests: 120, reports: 100, strategiesSaved: 40, pineExports: 15, transcriptUploads: 8, transcriptExtractions: 8, failedTests: 2 },
      popular: { symbols: [{ name: "NQ", total: 80 }], timeframes: [{ name: "5m", total: 90 }], strategies: [{ name: "opening_range_breakout", total: 100 }] },
      dataSpend: { requests: 10, cacheHits: 7, cacheMisses: 3, providerFetches: 3, providerErrors: 0, premiumRows: 1000, premiumBlocked: 2, proxyUses: 1, providers: [{ name: "yahoo", total: 2 }], controls: { disableDatabento: false, cachedDatabentoOnly: false, disableYahoo: false, forceDailyCandles: false, forceProxyForFutures: false, disableLongWindows: false, updatedAt: null } },
      costs: { apiTotalUsd: 4.25, computeTotalUsd: 1.5, byUser: [] }
    } })));
    render(<AdminDashboard />);
    expect(await screen.findByText("Provider health, cost containment, and usage")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
    expect(screen.getByText("NQ")).toBeTruthy();
    expect(screen.getByText("$4.2500")).toBeTruthy();
    expect(screen.getByText(/never fabricated/)).toBeTruthy();
  });
});

