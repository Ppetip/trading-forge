import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";

describe("user preferences", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("applies and persists theme, chart, market, symbol, timeframe, date, risk, timezone, fee, and slippage defaults", () => {
    const view = render(<App />);
    fireEvent.click(screen.getByText("Preferences"));
    fireEvent.change(screen.getByLabelText("Default symbol"), { target: { value: "ES" } });
    fireEvent.change(screen.getByLabelText("Default timeframe"), { target: { value: "15m" } });
    fireEvent.change(screen.getByLabelText("Default date range"), { target: { value: "1y" } });
    fireEvent.change(screen.getByLabelText("Default reward / risk"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Session timezone"), { target: { value: "UTC" } });
    fireEvent.change(screen.getByLabelText("Chart style"), { target: { value: "line" } });
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
    expect(view.container.querySelector(".app-shell.light")).toBeTruthy();
    fireEvent.click(screen.getByText("Save preferences"));
    const preferences = JSON.parse(localStorage.getItem("edgelab.preferences.v1") ?? "{}");
    expect(preferences).toMatchObject({
      market: "Futures", symbol: "ES", timeframe: "15m", dateRange: "1y",
      rewardRisk: 2.5, timezone: "UTC", chartStyle: "line", theme: "light",
      fees: true, slippage: true,
    });
  });
});
