import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DailyLevelWorkspace from "./DailyLevelWorkspace";

const response = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));
const csv = `timestamp,open,high,low,close
2026-01-05T08:00:00,100,101,99,100
2026-01-05T08:05:00,100,100.5,99.5,100
2026-01-06T08:00:00,100,102,100,101.5
2026-01-06T08:05:00,101.5,104,101,103.5`;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("server-backed previous-day workspace", () => {
  it("uploads multi-day candles, exposes exact rules, and renders a server report", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return response(200, { account: {} });
      if (path === "/api/backtests/daily-level" && init?.method === "POST") return response(201, {
        cached: false,
        report: {
          id: "daily-1", engineVersion: "daily-level-1.0.0",
          rules: { name: "NQ Previous Day Sweep Reversal" },
          result: { trades: [{ id: 1 }], totalR: 1.94, averageR: 1.94, winRate: 100, maxDrawdown: 0, profitFactor: null }
        }
      });
      return response(404, { error: { message: "Not found" } });
    }));
    const view = render(<DailyLevelWorkspace />);
    await screen.findByText("Previous-day level research");
    fireEvent.change(screen.getByLabelText("Strategy"), { target: { value: "previous_day_sweep" } });
    expect(view.container.querySelector("pre")?.textContent).toContain("pierce_level_then_close_back_inside");
    const file = new File([csv], "nq-daily.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(csv) });
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await screen.findByText(/nq-daily.csv · 4 candles · 2 dates/);
    fireEvent.click(screen.getByText("Run server backtest"));
    expect(await screen.findByText("NEW IMMUTABLE REPORT")).toBeTruthy();
    expect(screen.getByText("daily-level-1.0.0")).toBeTruthy();
    expect(screen.getAllByText("+1.94R")).toHaveLength(2);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/backtests/daily-level", expect.objectContaining({ method: "POST" })));
  });
});
