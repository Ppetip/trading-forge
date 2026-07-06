import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SaaSPlans from "./SaaSPlans";

const response = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));
const baseAccount = {
  id: "u1", email: "trader@example.com", displayName: "Trader", role: "user",
  subscriptionStatus: "active",
  usage: { limits: { backtests: 5, savedStrategies: 3, savedReports: 3, pineExports: 0, transcriptExtractions: 0 }, used: { backtests: 0, pineExports: 0, transcriptExtractions: 0 } }
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Stripe billing controls", () => {
  it("creates a hosted Checkout link without changing plan state in the browser", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return response(200, { account: { ...baseAccount, plan: "free" } });
      if (path === "/api/reports") return response(200, { reports: [] });
      if (path === "/api/billing/checkout" && init?.method === "POST") return response(201, { session: { id: "cs_1", url: "https://checkout.stripe.test/pay" } });
      return response(404, { error: { message: "Not found" } });
    }));
    render(<SaaSPlans />);
    fireEvent.click(await screen.findByText("Start Pro checkout"));
    const link = await screen.findByText("Continue to secure Stripe Checkout");
    expect(link.closest("a")?.getAttribute("href")).toBe("https://checkout.stripe.test/pay");
    expect(screen.getAllByText("Current")).toHaveLength(1);
    expect(screen.getByText(/signed webhook confirms/)).toBeTruthy();
  });

  it("creates a customer portal link for an active Pro account", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/account") return response(200, { account: { ...baseAccount, plan: "pro", usage: { limits: { ...baseAccount.usage.limits, pineExports: 500 }, used: baseAccount.usage.used } } });
      if (path === "/api/reports") return response(200, { reports: [] });
      if (path === "/api/billing/portal" && init?.method === "POST") return response(201, { session: { id: "bps_1", url: "https://billing.stripe.test/portal" } });
      return response(404, { error: { message: "Not found" } });
    }));
    render(<SaaSPlans />);
    fireEvent.click(await screen.findByText("Manage billing"));
    const link = await screen.findByText("Open Stripe billing portal");
    expect(link.closest("a")?.getAttribute("href")).toBe("https://billing.stripe.test/portal");
  });
});
