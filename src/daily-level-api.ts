import { ApiError } from "./saas-api";

export async function runDailyLevel(input: Record<string, unknown>) {
  const response = await fetch("/api/backtests/daily-level", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Request failed.", data.error?.details);
  return data as {
    cached: boolean;
    report: {
      id: string;
      engineVersion: string;
      rules: Record<string, unknown>;
      result: { trades: Array<Record<string, unknown>>; totalR: number; averageR: number; winRate: number; maxDrawdown: number; profitFactor: number | null };
    };
  };
}
