import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Root from "./Root";
import App from "./App";

describe("EdgeLab research workflow", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("routes from the research landing page into the workspace", async () => {
    render(<Root />);
    expect(screen.getByText("Turn trading ideas")).toBeTruthy();
    window.location.hash = "#/lab";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByText("Experimental local lab")).toBeTruthy());
    expect(screen.getByText("Choose the rule engine")).toBeTruthy();
    expect(screen.getByText("Parameters")).toBeTruthy();
  });

  it("runs and persists an exact strategy configuration", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Verified ORB" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "ES" } });
    fireEvent.click(screen.getByText("Run backtest"));
    await waitFor(() => expect(localStorage.getItem("edgelab.runs.v1")).toBeTruthy());
    expect(screen.getByText(/RESULTS.*DEMO DATA/)).toBeTruthy();
    const runs = JSON.parse(localStorage.getItem("edgelab.runs.v1") ?? "[]");
    expect(runs).toHaveLength(1);
    expect(runs[0].rules.name).toBe("Verified ORB");
    expect(runs[0].rules.symbol).toBe("ES");
    expect(runs[0].dataSource).toBe("demo");
    expect(runs[0].trades.length).toBeGreaterThan(0);
  });

  it("opens a stored run by its durable run id", async () => {
    const view = render(<App />);
    fireEvent.click(screen.getByText("Run backtest"));
    await waitFor(() => expect(localStorage.getItem("edgelab.runs.v1")).toBeTruthy());
    const [run] = JSON.parse(localStorage.getItem("edgelab.runs.v1") ?? "[]");
    view.unmount();
    window.location.hash = `#/runs/${encodeURIComponent(run.id)}`;
    render(<Root />);
    expect(await screen.findByText("SAVED BACKTEST DETAIL")).toBeTruthy();
    expect(screen.getByText("Frozen rules")).toBeTruthy();
    expect(screen.getByText("All trades")).toBeTruthy();
    expect(screen.getByText("Illustrative result.")).toBeTruthy();
  });
});



