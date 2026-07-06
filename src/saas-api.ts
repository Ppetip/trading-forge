export interface ApiAccount {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  plan: "free" | "starter" | "trial" | "pro" | "power";
  subscriptionStatus: string;
  trialEndsAt?: string;
  currentPeriodEndsAt?: string;
  usage: { limits: Record<string, number>; used: Record<string, number> };
}

export class ApiError extends Error {
  status: number; code: string; details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin", ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Request failed.", data.error?.details);
  return data as T;
}

export const saasApi = {
  register: (input: { email: string; displayName: string; password: string }) =>
    request<{ user: { id: string; email: string; displayName: string; plan: string } }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<{ user: { id: string; email: string; displayName: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  account: () => request<{ account: ApiAccount }>("/api/account"),
  startTrial: () => request<{ trial: { plan: "trial"; status: "trialing"; trialEndsAt: string } }>("/api/billing/trial", { method: "POST" }),
  parseRules: (prompt: string, defaults?: Record<string, unknown>) =>
    request<{ parser: string; rules: Record<string, unknown>; assumptions: string[]; untestable: string[]; clarificationNeeded: boolean }>("/api/ai/parse-rules", {
      method: "POST", body: JSON.stringify({ prompt, defaults })
    }),
  preflightClassify: (prompt: string, defaults?: Record<string, unknown>) =>
    request<{ preflight: Record<string, unknown> }>("/api/ai/preflight-classify", {
      method: "POST", body: JSON.stringify({ prompt, defaults })
    }),
  strategies: () => request<{ strategies: Array<Record<string, unknown>> }>("/api/strategies"),
  createStrategy: (input: Record<string, unknown>) =>
    request<{ strategy: { id: string; versionId: string; versionNumber: number } }>("/api/strategies", { method: "POST", body: JSON.stringify(input) }),
  createVersion: (strategyId: string, input: Record<string, unknown>) =>
    request<{ version: { id: string; strategyId: string; versionNumber: number; parentVersionId: string } }>(`/api/strategies/${strategyId}/versions`, { method: "POST", body: JSON.stringify(input) }),
  strategy: (strategyId: string) =>
    request<{ strategy: Record<string, unknown>; versions: Array<Record<string, unknown>> }>(`/api/strategies/${strategyId}`),
  runOrb: (input: Record<string, unknown>) =>
    request<{ cached: boolean; report: { id: string; rules: Record<string, unknown>; result: Record<string, unknown>; createdAt: string } }>("/api/backtests/orb", { method: "POST", body: JSON.stringify(input) }),
  runDailyLevel: (input: Record<string, unknown>) =>
    request<{ cached: boolean; report: { id: string; rules: Record<string, unknown>; result: Record<string, unknown>; createdAt: string } }>("/api/backtests/daily-level", { method: "POST", body: JSON.stringify(input) }),
  publicReports: () => request<{ reports: Array<Record<string, unknown>> }>("/api/public/reports"),
  reports: () => request<{ reports: Array<Record<string, unknown>> }>("/api/reports"),
  report: (id: string) => request<{ report: Record<string, unknown> }>(`/api/reports/${id}`),
  reviewReport: (id: string, input: { mode: "review" | "plan"; question?: string }) =>
    request<{ review: { model: string; mode: string; headline: string; summary: string; findings: string[]; experiments: string[]; risks: string[]; answer: string } }>(`/api/reports/${id}/ai-review`, { method: "POST", body: JSON.stringify(input) }),
  publicReport: (id: string) => request<{ report: Record<string, unknown> }>(`/api/public/reports/${id}`),
  setReportVisibility: (id: string, visibility: "private" | "public") =>
    request<{ report: Record<string, unknown> }>(`/api/reports/${id}`, { method: "PATCH", body: JSON.stringify({ visibility }) }),
  exportPine: (reportId: string) =>
    request<{ filename: string; script: string }>(`/api/reports/${reportId}/pine`, { method: "POST" })
};


