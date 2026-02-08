// API helper (frontend)
// Zakładamy, że backend (FastAPI) stoi na http://127.0.0.1:8000
// oraz ma endpointy /api/* jak w main.py

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

export type LastRate = {
  pair: string;
  date: string;
  value: number;
  dailyChange: number;
  dailyChangePct: number;
};

export type ResultsPayload = {
  lastRate: LastRate | null;
  metrics: any;
  forecast7: Array<Record<string, any>>;
  updatedAt: string;
};

export type RunResponse = ResultsPayload & {
  ok: boolean;
  logs?: string;
};

export type SeriesPoint = { date: string; value: number };

export type SeriesResponse = {
  series: SeriesPoint[];
};

export type LogsResponse = {
  chunk: string;
  nextOffset: number;
  running: boolean;
  stage: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

const API_BASE = "http://127.0.0.1:8000";

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text();
    try {
      const js = JSON.parse(txt);
      throw new Error(js?.detail ?? txt);
    } catch {
      throw new Error(txt);
    }
  }

  return (await r.json()) as T;
}

export const api = {
  run: (params: RunParams) => postJson<RunResponse>("/api/run", params),
  results: () => getJson<ResultsPayload>("/api/results"),
  series: (days = 365) => getJson<SeriesResponse>(`/api/series?days=${days}`),

  logs: (offset = 0) => getJson<LogsResponse>(`/api/logs?offset=${offset}`),

  artifactUrl: (filename: string) => `${API_BASE}/api/artifacts/${encodeURIComponent(filename)}`,
};
