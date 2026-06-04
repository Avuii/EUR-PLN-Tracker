export const API_URL = String(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export type ResultsResponse = {
  lastRate?: {
    date?: string;
    value?: number;
    prevValue?: number;
    delta?: number;
    deltaPct?: number;
  } | null;
  runConfig?: any;
  metrics?: any;
  summary?: any;
  updatedAt?: string;
  runDir?: string;
};

export type ForecastRow = Record<string, any> & {
  date?: string;
  baseline?: number | null;
  best_value?: number | null;
};

export type PredictionsTestRow = Record<string, any> & {
  date: string;
  target_date?: string;
  y_t?: number | null;
  true_tomorrow?: number | null;
  true_target?: number | null;
  pred_best?: number | null;
};

function endpoint(path: string) {
  return `${API_URL}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(endpoint(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: any = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = data?.detail ?? data?.message ?? data ?? res.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
  }

  return data as T;
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function firstValue(row: any, keys: string[]) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return null;
}

function normalizeForecastRow(row: any): ForecastRow {
  const out: ForecastRow = { ...(row ?? {}) };

  out.date = String(firstValue(row, ["date", "target_date", "forecast_target_date"]) ?? "");
  out.baseline = num(firstValue(row, ["baseline", "Naive", "naive", "SMA", "sma"]));
  out.naive = num(firstValue(row, ["naive", "Naive", "baseline"]));
  out.sma = num(firstValue(row, ["sma", "SMA"]));
  out.ema = num(firstValue(row, ["ema", "EMA"]));
  out.ridge = num(firstValue(row, ["ridge", "Ridge"]));
  out.elastic = num(firstValue(row, ["elastic", "ElasticNet"]));
  out.rf = num(firstValue(row, ["rf", "RandomForest"]));
  out.extra = num(firstValue(row, ["extra", "ExtraTrees"]));
  out.hgb = num(firstValue(row, ["hgb", "HistGB"]));
  out.sarimax = num(firstValue(row, ["sarimax", "SARIMAX"]));
  out.mlp = num(firstValue(row, ["mlp", "MLPRegressor"]));
  out.xgb = num(firstValue(row, ["xgb", "XGBoost"]));
  out.lgbm = num(firstValue(row, ["lgbm", "LightGBM"]));
  out.best_value = num(firstValue(row, ["best_value", row?.best_model, "pred_best"]));
  out.p80_low = num(firstValue(row, ["p80_low"]));
  out.p80_high = num(firstValue(row, ["p80_high"]));
  out.p95_low = num(firstValue(row, ["p95_low"]));
  out.p95_high = num(firstValue(row, ["p95_high"]));

  return out;
}

function normalizePredictionRow(row: any): PredictionsTestRow {
  const out: PredictionsTestRow = { ...(row ?? {}), date: String(row?.date ?? "") };

  out.target_date = row?.target_date ? String(row.target_date) : undefined;
  out.y_t = num(row?.y_t);
  out.true_target = num(firstValue(row, ["true_target", "target", "true_tomorrow"]));
  out.true_tomorrow = out.true_target;

  out.pred_best = num(firstValue(row, ["pred_best", "best_value"]));
  out.pred_baseline = num(firstValue(row, ["pred_baseline", "pred_Naive", "Naive", "naive"]));
  out.pred_naive = num(firstValue(row, ["pred_naive", "pred_Naive", "Naive", "naive"]));
  out.pred_ma5 = num(firstValue(row, ["pred_ma5", "pred_SMA", "SMA", "sma"]));
  out.pred_sma = num(firstValue(row, ["pred_sma", "pred_SMA", "SMA", "sma"]));
  out.pred_ema = num(firstValue(row, ["pred_ema", "pred_EMA", "EMA", "ema"]));
  out.pred_momentum = num(firstValue(row, ["pred_momentum", "pred_Momentum", "Momentum", "pred_EMA", "EMA", "ema"]));
  out.pred_ridge = num(firstValue(row, ["pred_ridge", "pred_Ridge", "Ridge", "ridge"]));
  out.pred_elastic = num(firstValue(row, ["pred_elastic", "pred_ElasticNet", "ElasticNet", "elastic"]));
  out.pred_rf = num(firstValue(row, ["pred_rf", "pred_RandomForest", "RandomForest", "rf"]));
  out.pred_extra = num(firstValue(row, ["pred_extra", "pred_ExtraTrees", "ExtraTrees", "extra"]));
  out.pred_hgb = num(firstValue(row, ["pred_hgb", "pred_HistGB", "HistGB", "hgb"]));
  out.pred_sarimax = num(firstValue(row, ["pred_sarimax", "pred_SARIMAX", "SARIMAX", "sarimax"]));
  out.pred_mlp = num(firstValue(row, ["pred_mlp", "pred_MLPRegressor", "MLPRegressor", "mlp"]));
  out.pred_xgb = num(firstValue(row, ["pred_xgb", "pred_XGBoost", "XGBoost", "xgb"]));
  out.pred_lgbm = num(firstValue(row, ["pred_lgbm", "pred_LightGBM", "LightGBM", "lgbm"]));

  return out;
}

function normalizeSeriesRows(rows: any[]) {
  return rows
    .map((row) => ({
      date: String(row?.date ?? ""),
      value: num(row?.value),
    }))
    .filter((row) => row.date && row.value !== null) as Array<{ date: string; value: number }>;
}

export const api = {
  async health() {
    return requestJson<any>("/api/health");
  },

  async results(): Promise<ResultsResponse> {
    return requestJson<ResultsResponse>("/api/results");
  },

  async series(days = 3650): Promise<{ series: Array<{ date: string; value: number }> }> {
    const data = await requestJson<any>(`/api/series?days=${encodeURIComponent(days)}`);
    return { series: normalizeSeriesRows(data?.series ?? []) };
  },

  async data(limit = 500): Promise<{ rows: Array<{ date: string; value: number }> }> {
    const data = await requestJson<any>(`/api/data?limit=${encodeURIComponent(limit)}`);
    return { rows: normalizeSeriesRows(data?.rows ?? []) };
  },

  async logs(offset = 0) {
    return requestJson<any>(`/api/logs?offset=${encodeURIComponent(offset)}`);
  },

  async run(payload: any) {
    const body = {
      config: payload?.config ?? "configs/config.json",
      skip_fetch: Boolean(payload?.skip_fetch ?? payload?.skipFetch ?? false),
      skip_build: Boolean(payload?.skip_build ?? payload?.skipBuild ?? false),
      skip_train: Boolean(payload?.skip_train ?? payload?.skipTrain ?? false),
      no_tuning: Boolean(payload?.no_tuning ?? payload?.noTuning ?? false),
      test_size_samples: payload?.test_size_samples ?? payload?.testSizeSamples ?? undefined,
      val_size_samples: payload?.val_size_samples ?? payload?.valSizeSamples ?? undefined,
      backtest_windows: payload?.backtest_windows ?? payload?.backtestWindows ?? undefined,
    };

    return requestJson<any>("/api/run", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async forecast(h = 30): Promise<ForecastRow[]> {
    const data = await requestJson<any>(`/api/forecast?h=${encodeURIComponent(h)}`);
    return (data?.rows ?? []).map(normalizeForecastRow);
  },

  async predictions(h = 30, limit?: number): Promise<PredictionsTestRow[]> {
    const data = await requestJson<any>(`/api/predictions?h=${encodeURIComponent(h)}`);
    const rows = (data?.rows ?? []).map(normalizePredictionRow);
    return typeof limit === "number" && limit > 0 ? rows.slice(-limit) : rows;
  },

  async predictionsTest(limit = 260, h = 30): Promise<PredictionsTestRow[]> {
    return this.predictions(h, limit);
  },

  async errorsTest(modelKey = "pred_best", limit = 260, h = 30) {
    const rows = await this.predictions(h, limit);

    return rows.map((row) => {
      const y = num(row.true_target ?? row.true_tomorrow);
      const pred = num(row[modelKey]);
      const error = y !== null && pred !== null ? pred - y : null;

      return {
        date: row.target_date ?? row.date,
        true_tomorrow: y,
        pred,
        error,
        abs_error: error === null ? null : Math.abs(error),
      };
    });
  },
};
