import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Root from "./Root";
import StrategyLab from "./StrategyLab";

function candleCsv() {
  const rows = ["timestamp,open,high,low,close"];
  const start = new Date("2026-01-05T08:00:00");
  for (let index = 0; index < 180; index += 1) {
    const time = new Date(start);
    time.setMinutes(start.getMinutes() + index * 5);
    const close = 100 + Math.sin(index / 6) * 6 + index * 0.025;
    rows.push(`${time.toISOString().slice(0, 19)},${(close - 0.2).toFixed(3)},${(close + 0.8).toFixed(3)},${(close - 0.8).toFixed(3)},${close.toFixed(3)}`);
  }
  return rows.join("\n");
}

describe("uploaded candle workflow", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uploads candles, runs a non-ORB engine, stores it, and opens detail", async () => {
    const file = new File([candleCsv()], "nq-5m.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(candleCsv()) });
    const view = render(<StrategyLab />);

    fireEvent.click(screen.getByText("Moving average crossover"));
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/180 candles loaded/);
    expect(screen.getByText(/"data_source": "nq-5m.csv"/)).toBeTruthy();

    fireEvent.click(screen.getByText("Run backtest"));
    await screen.findByText(/Run stored with/);
    expect(screen.getByText("UPLOADED DATA RESULT")).toBeTruthy();
    expect(screen.getByText("Full detail")).toBeTruthy();

    const runs = JSON.parse(localStorage.getItem("edgelab.runs.v1") ?? "[]");
    expect(runs).toHaveLength(1);
    expect(runs[0].dataSource).toBe("uploaded");
    expect(runs[0].rules.strategyType).toBe("moving_average_crossover");

    view.unmount();
    window.location.hash = `#/runs/${encodeURIComponent(runs[0].id)}`;
    render(<Root />);
    await waitFor(() => expect(screen.getByText("SAVED BACKTEST DETAIL")).toBeTruthy());
    expect(document.body.textContent).toContain("Uploaded candle data");
  });

  it("rejects malformed uploads without creating a run", async () => {
    const file = new File(["date,price\n2026-01-01,100"], "bad.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue("date,price\n2026-01-01,100") });
    const view = render(<StrategyLab />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/headers must include timestamp/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Run backtest"));
    expect(screen.getByText(/Upload historical OHLC candles/i)).toBeTruthy();
    expect(localStorage.getItem("edgelab.runs.v1")).toBeNull();
  });
});
