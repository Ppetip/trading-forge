import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SaaSSamples from "./SaaSSamples";
import { SAMPLE_STRATEGIES } from "./sample-strategies";

afterEach(cleanup);

describe("educational sample strategy packs", () => {
  it("contains exactly 15 famous-inspired and 15 common templates", () => {
    expect(SAMPLE_STRATEGIES.filter((item) => item.pack === "famous-inspired")).toHaveLength(15);
    expect(SAMPLE_STRATEGIES.filter((item) => item.pack === "common")).toHaveLength(15);
  });

  it("labels inspiration, education status, and current engine availability honestly", () => {
    render(<SaaSSamples />);
    expect(screen.getByText("Famous-inspired strategy pack")).toBeTruthy();
    expect(screen.getByText("Common retail strategy pack")).toBeTruthy();
    expect(screen.getByText(/not official strategies/)).toBeTruthy();
    expect(screen.getByText(/may perform poorly/)).toBeTruthy();
    expect(screen.getByText("QQQ 9:30 AM ORB")).toBeTruthy();
    expect(screen.getAllByText("ORB ENGINE READY")).toHaveLength(3);
    expect(screen.getAllByText("ENGINE ROADMAP")).toHaveLength(27);
  });
});
