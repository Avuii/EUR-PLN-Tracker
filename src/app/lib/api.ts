// src/app/lib/api.ts

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const BASE = `${API_BASE}/api`;

function qs(params: Record<string, any>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function normalizeLogs(logs: unknown): string[] {
  if (Array.isArray(logs)) return logs.map((x) => String(x)).filter(Boolean);
  return String(logs ?? "").split(/\r?\n/).filter(Boolean);
}

export type SeriesPoint = { date: string; value: number };
export type PredictionTestRow = {
  date: string;
  true: number;
  baseline: number;
  ridge: number;
  rf: number;
  errBaseline: number;
  errRidge: number;
  errRf: number;
};

export type Forecast7Row = { date: string; baseline: number; ridge: number; rf: number };
export type MetricsPayload = Record<string, any>;

export type ResultsResponse = {
  lastRate: { date: string; value: number } | null;
  metrics: MetricsPayload | null;
  forecast7: Forecast7Row[];
};

export type RunParams = {
  years: number;
  refresh: boolean;
  noTuning: boolean;
  testSizeSamples: number;
  zoomWindowDays: number;
  forecastDays7: number;
  forecastDays1m: number;
  forecastDays12m: number;
};

export type RunResponse = { ok: boolean; logs?: string[] };

export const api = {
  results: async (): Promise<ResultsResponse> => json<ResultsResponse>("/results"),
  series: async (days: number) => json<{ series: SeriesPoint[] }>(`/series${qs({ days })}`),
  predictionsTest: async (rows = 800) =>
    json<{ rows: PredictionTestRow[] }>(`/predictions-test${qs({ rows })}`),

  logs: async () => {
    const data = await json<{ logs: unknown }>("/logs");
    return { logs: normalizeLogs(data?.logs) };
  },

  run: async (params: RunParams): Promise<RunResponse> => {
    const data = await json<{ ok: boolean; logs?: unknown }>("/run", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return { ok: !!data?.ok, logs: normalizeLogs(data?.logs) };
  },

  downloadXlsx: async (kind: "data" | "results") => {
    const res = await fetch(`${BASE}/export/${kind}.xlsx`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  },
};

export async function fetchResults() {
  return await api.results();
}
