import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SaaSPlans from "./SaaSPlans";

const freeAccount = {
  id: "u1", email: "trader@example.com", displayName: "Trader", role: "user",
  plan: "free", subscriptionStatus: "active",
  usage: { limits: { backtests: 5, savedStrategies: 3, savedReports: 3, pineExports: 0 }, used: { backtests: 1, pineExports: 0 } }
};
const trialAccount = {
  ...freeAccount, plan: "trial", subscriptionStatus: "trialing",
  usage: { limits: { backtests: 50, savedStrategies: 25, savedReports: 50, pineExports: 20 }, used: { backtests: 1, pineExports: 0 } }
};
const jsonResponse = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("plans and entitlements UI", () => {
  it("starts a one-time trial and refreshes entitlements", async () => {
    let trial = false;
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return jsonResponse(200, { account: trial ? trialAccount : freeAccount });
      if (path === "/api/reports") return jsonResponse(200, { reports: [] });
      if (path === "/api/billing/trial" && init?.method === "POST") {
        trial = true;
        return jsonResponse(201, { trial: { plan: "trial", status: "trialing", trialEndsAt: "2026-07-18T00:00:00.000Z" } });
      }
      return jsonResponse(404, { error: { message: "Not found" } });
    }));
    render(<SaaSPlans />);
    expect(await screen.findByText("Start free trial")).toBeTruthy();
    fireEvent.click(screen.getByText("Start free trial"));
    expect(await screen.findByText(/Trial active through/)).toBeTruthy();
    expect(screen.getByText("Trial active")).toBeTruthy();
    expect(screen.getByText("0/20 exports this month")).toBeTruthy();
  });
});
