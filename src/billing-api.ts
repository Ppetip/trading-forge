import { ApiError } from "./saas-api";

async function createSession(path: string) {
  const response = await fetch(path, { method: "POST", credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "BILLING_FAILED", data.error?.message ?? "Billing request failed.");
  return data as { session: { id: string; url: string } };
}

export const billingApi = {
  checkout: () => createSession("/api/billing/checkout"),
  portal: () => createSession("/api/billing/portal")
};
