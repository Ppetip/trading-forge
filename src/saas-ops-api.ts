import { ApiError } from "./saas-api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Request failed.", data.error?.details);
  return data as T;
}

export type TranscriptSource = {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  content: string;
  status: string;
  createdAt: string;
  extraction: {
    parser: string;
    summary: string;
    rules: Record<string, unknown>;
    detected?: { market: unknown; symbol: unknown; timeframe: unknown; entry: unknown; stop: unknown; target: unknown; filters: unknown[]; risk: Record<string, unknown>; missing: string[]; unsupported: string[]; backtestReady: boolean };
    assumptions: string[];
    untestable: string[];
    clarificationNeeded: boolean;
    warning: string;
  };
};

export type AdminMetrics = {
  generatedAt: string;
  users: { total: number; newSignups30d: number; free: number; trial: number; paid: number; conversionRate: number; churnRate: number };
  activity: { backtests: number; reports: number; strategiesSaved: number; pineExports: number; transcriptUploads: number; transcriptExtractions: number; failedTests: number };
  popular: {
    symbols: Array<{ name: string; total: number }>;
    timeframes: Array<{ name: string; total: number }>;
    strategies: Array<{ name: string; total: number }>;
  };
  costs: { apiTotalUsd: number; computeTotalUsd: number; byUser: Array<{ userId: string; apiUsd: number; computeUsd: number }> };
  dataSpend: { controls: DataControls & { updatedAt: string | null }; requests: number; cacheHits: number; cacheMisses: number; providerFetches: number; providerErrors: number; premiumBlocked: number; premiumBudgetUsed: number; proxyUses: number; premiumRows: number; providers: Array<{ name: string; total: number }>; symbols: Array<{ name: string; total: number }> };
};

export type DataControls = { disableDatabento: boolean; cachedDatabentoOnly: boolean; disableYahoo: boolean; forceDailyCandles: boolean; forceProxyForFutures: boolean; disableLongWindows: boolean };

export const opsApi = {
  transcripts: () => request<{ sources: TranscriptSource[] }>("/api/transcripts"),
  extractTranscript: (input: { title: string; sourceType: string; sourceUrl?: string; content: string }) =>
    request<{ source: TranscriptSource }>("/api/transcripts", { method: "POST", body: JSON.stringify(input) }),
  adminMetrics: () => request<{ metrics: AdminMetrics }>("/api/admin/metrics"),
  updateDataControls: (controls: Partial<DataControls>) => request<{ controls: DataControls & { updatedAt: string } }>("/api/admin/data-controls", { method: "PATCH", body: JSON.stringify(controls) })
};


