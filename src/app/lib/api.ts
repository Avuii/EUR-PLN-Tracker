// src/app/lib/api.ts
export const API_URL =
  (import.meta as any).env?.VITE_API_URL ??
  (import.meta as any).env?.VITE_API_BASE_URL ??
  "";

type HttpMethod = "GET" | "POST";

export type RunState = {
  running: boolean;
  stage?: "fetch" | "train" | null;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type HealthResponse = {
  ok: boolean;
  time?: string;
};

export type LastRateResponse = {
  date: string;
  value: number;
  prevValue?: number;
  delta?: number;
  deltaPct?: number;
};

export type ResultsResponse = {
  updatedAt?: string;
  timestamp?: string; // alias pod starszy UI
  lastRate?: LastRateResponse | null;
  runConfig?: any;
  metrics?: any;
  backtest?: any;
  forecast7?: any[];
  forecast30?: any[];
  forecast90?: any[];
  forecast180?: any[];
  forecast365?: any[];
  forecast1m?: any[];
  forecast12m?: any[];
};

export type SeriesPoint = {
  date: string;
  value: number;
};

export type PredictionsTestRow = {
  date: string;
  today_value: number;
  true_tomorrow: number;

  best_model?: string | null;
  pred_best?: number | null;

  pred_baseline?: number | null;
  pred_ma5?: number | null;
  pred_momentum?: number | null;
  pred_ridge?: number | null;
  pred_rf?: number | null;
  pred_extra?: number | null;
  pred_hgb?: number | null;

  [k: string]: any;
};

export type ForecastRow = {
  date: string;

  baseline?: number | null;
  ridge?: number | null;
  rf?: number | null;
  extra?: number | null;
  hgb?: number | null;

  best_model?: string | null;
  best_value?: number | null;

  p80_low?: number | null;
  p80_high?: number | null;
  p95_low?: number | null;
  p95_high?: number | null;

  best_p80_low?: number | null;
  best_p80_high?: number | null;
  best_p95_low?: number | null;
  best_p95_high?: number | null;

  [k: string]: any;
};

export type LogsResponse = {
  text: string;
  nextOffset: number;
  state: RunState;
};

function normalizeScalar(value: any): any {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed === "") return null;

    const lowered = trimmed.toLowerCase();
    if (lowered === "nan" || lowered === "null" || lowered === "none" || lowered === "undefined") {
      return null;
    }

    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;

    return trimmed;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return value;
}

function normalizeObject<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    out[k] = normalizeScalar(v);
  }
  return out as T;
}

async function fetchJson<T>(path: string, method: HttpMethod = "GET", body?: any): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.detail ? String(j.detail) : JSON.stringify(j);
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.detail ? String(j.detail) : JSON.stringify(j);
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return await res.text();
}

function parseCsv(text: string): Array<Record<string, any>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const rows: Array<Record<string, any>> = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const row: Record<string, any> = {};

    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      row[key] = normalizeScalar(parts[c] ?? "");
    }

    rows.push(row);
  }

  return rows;
}

async function fetchArtifactCsvAny(filenames: string[]): Promise<Array<Record<string, any>>> {
  let lastErr: any = null;

  for (const fn of filenames) {
    try {
      const txt = await fetchText(`/api/artifacts/${encodeURIComponent(fn)}`);
      return parseCsv(txt);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("Artifact not found");
}

function normalizeForecastRows(rows: ForecastRow[]): ForecastRow[] {
  return rows.map((r) => {
    const row = normalizeObject(r);

    return {
      ...row,
      p80_low: row.p80_low ?? row.best_p80_low ?? null,
      p80_high: row.p80_high ?? row.best_p80_high ?? null,
      p95_low: row.p95_low ?? row.best_p95_low ?? null,
      p95_high: row.p95_high ?? row.best_p95_high ?? null,
      best_value:
        row.best_value ??
        (row.best_model === "ridge_delta"
          ? row.ridge
          : row.best_model === "random_forest_delta"
            ? row.rf
            : row.best_model === "extra_trees_delta"
              ? row.extra
              : row.best_model === "hist_gb_delta"
                ? row.hgb
                : null),
    };
  });
}

export const api = {
  health: () => fetchJson<HealthResponse>("/api/health"),

  run: (body: any = {}) => fetchJson<{ ok: boolean }>("/api/run", "POST", body),
  fetch: (body: any = {}) => fetchJson<{ ok: boolean }>("/api/fetch", "POST", body),
  train: (body: any = {}) => fetchJson<{ ok: boolean }>("/api/train", "POST", body),

  results: async (): Promise<ResultsResponse> => {
    const res = await fetchJson<ResultsResponse>("/api/results");
    return {
      ...res,
      timestamp: res.timestamp ?? res.updatedAt,
      forecast7: normalizeForecastRows((res.forecast7 ?? []) as ForecastRow[]),
      forecast30: normalizeForecastRows((res.forecast30 ?? []) as ForecastRow[]),
      forecast90: normalizeForecastRows((res.forecast90 ?? []) as ForecastRow[]),
      forecast180: normalizeForecastRows((res.forecast180 ?? []) as ForecastRow[]),
      forecast365: normalizeForecastRows((res.forecast365 ?? []) as ForecastRow[]),
      forecast1m: normalizeForecastRows((res.forecast1m ?? []) as ForecastRow[]),
      forecast12m: normalizeForecastRows((res.forecast12m ?? []) as ForecastRow[]),
    };
  },

  series: (days = 1830, freq = "daily") =>
    fetchJson<{ series: SeriesPoint[] }>(`/api/series?days=${days}&freq=${encodeURIComponent(freq)}`),

  data: (limit = 500, freq = "daily") =>
    fetchJson<{ rows: SeriesPoint[] }>(`/api/data?limit=${limit}&freq=${encodeURIComponent(freq)}`),

  predictionsTest: async (limit = 0): Promise<PredictionsTestRow[]> => {
    const rows = (await fetchArtifactCsvAny(["predictions_test.csv"])) as PredictionsTestRow[];
    const normalized = rows.map((r) => normalizeObject(r) as PredictionsTestRow);

    if (!limit || limit <= 0) return normalized;
    return normalized.slice(Math.max(0, normalized.length - limit));
  },

  forecast: async (horizon: number): Promise<ForecastRow[]> => {
    const filesByH: Record<number, string[]> = {
      7: ["forecast_next7.csv"],
      30: ["forecast_next30.csv", "forecast_next1m.csv"],
      90: ["forecast_next90.csv"],
      180: ["forecast_next180.csv"],
      365: ["forecast_next365.csv", "forecast_next12m.csv"],
    };

    const candidates = filesByH[horizon] ?? [`forecast_next${horizon}.csv`];
    const rows = (await fetchArtifactCsvAny(candidates)) as ForecastRow[];
    return normalizeForecastRows(rows);
  },

  errorsTest: async (modelKey: string, limit = 0) => {
    const rows = await api.predictionsTest(limit);

    return rows.map((r) => {
      const pred = Number(r?.[modelKey]);
      const trueVal = Number(r?.true_tomorrow);
      const err = Number.isFinite(pred) && Number.isFinite(trueVal) ? pred - trueVal : null;

      return {
        date: String(r.date),
        true_tomorrow: Number.isFinite(trueVal) ? trueVal : null,
        pred: Number.isFinite(pred) ? pred : null,
        error: err,
        abs_error: err == null ? null : Math.abs(err),
      };
    });
  },

  logs: () => fetchJson<LogsResponse>("/api/logs"),
};

export default api;