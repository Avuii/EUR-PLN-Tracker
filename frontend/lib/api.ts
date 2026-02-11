// src/app/lib/api.ts
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
  pair?: string;
  date: string;
  value: number;
  dailyChange?: number | null;
  dailyChangePct?: number | null;
};

export type ForecastPoint = {
  date: string;
  baseline: number;
  ridge: number;
  rf: number;
};

export type ResultsPayload = {
  updatedAt?: string;
  lastRate?: LastRate;
  metrics?: any;
  forecast7?: ForecastPoint[];
};

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

export type ErrorTestRow = {
  date: string;
  baseline: number;
  ridge: number;
  rf: number;
};

const DEFAULT_BASE = "http://127.0.0.1:8000";
// kompatybilność: README często używa VITE_API_BASE_URL
const RAW_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_URL ??
  DEFAULT_BASE
).trim();
const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, "") : "";

function url(path: string) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${txt ? `: ${txt}` : ""}`);
  }

  return (await res.json()) as T;
}

async function httpText(path: string): Promise<string> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

// --- CSV helpers (proste, wystarcza na nasze artefakty) ---
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // obsługa "" jako escape
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (const line of lines.slice(1)) {
    const vals = splitCsvLine(line);
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? "";
    rows.push(obj);
  }
  return rows;
}

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n : NaN;
}

export const api = {
  results: () => httpJson<ResultsPayload>("/api/results"),

  series: (days: number) => httpJson<{ series: SeriesPoint[] }>(`/api/series?days=${days}`),

  data: (limit: number) => httpJson<{ rows: SeriesPoint[] }>(`/api/data?limit=${limit}`),

  run: (params: RunParams) =>
    httpJson<{ ok: boolean; logs?: string }>(`/api/run`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // backend może zwracać różne formaty logów — normalizujemy do {logs: string}
  logs: async () => {
    try {
      const r = await httpJson<any>(`/api/logs?offset=0`);
      return { logs: String(r?.chunk ?? r?.logs ?? "") };
    } catch {
      // fallback: brak endpointu /api/logs
      return { logs: "" };
    }
  },

  // artefakty CSV z train_eval.py
  artifactText: (name: string) => httpText(`/api/artifacts/${name}`),

  // predictions_test.csv -> ujednolicone klucze używane w komponentach
  predictionsTest: async (limit?: number) => {
    const txt = await api.artifactText("predictions_test.csv");
    const raw = parseCsv(txt);

    const rowsAll: PredictionTestRow[] = raw.map((r) => {
      const t = toNum(r.true_tomorrow);
      const b = toNum(r.pred_baseline);
      const rd = toNum(r.pred_ridge);
      const rf = toNum(r.pred_rf);

      return {
        date: String(r.date ?? ""),
        true: t,
        baseline: b,
        ridge: rd,
        rf,
        errBaseline: b - t,
        errRidge: rd - t,
        errRf: rf - t,
      };
    });

    const rows = limit && limit > 0 ? rowsAll.slice(-limit) : rowsAll;
    return { rows };
  },

  errorsTest: async (limit?: number) => {
    const p = await api.predictionsTest(limit);
    const rows: ErrorTestRow[] = p.rows.map((r) => ({
      date: r.date,
      baseline: r.errBaseline,
      ridge: r.errRidge,
      rf: r.errRf,
    }));
    return { rows };
  },
};
