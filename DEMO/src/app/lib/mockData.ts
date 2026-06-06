export type SeriesPoint = { date: string; value: number };

export type PredictionRow = Record<string, any> & {
  date: string;
  target_date: string;
  y_t: number;
  true_target: number;
  true_tomorrow: number;
  pred_best: number;
};

const START_DATE = new Date(Date.UTC(2022, 0, 3));
const HORIZONS = [1, 7, 30, 90, 180, 365];
const MODEL_NAMES = ["Naive", "SMA", "EMA", "Ridge", "ElasticNet", "RandomForest", "ExtraTrees", "HistGB", "SARIMAX", "MLPRegressor"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateToString(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(d: Date, days: number) {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addBusinessDays(d: Date, days: number) {
  let next = new Date(d.getTime());
  let added = 0;

  while (added < days) {
    next = addDays(next, 1);
    const day = next.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }

  return next;
}

function round4(v: number) {
  return Number(v.toFixed(4));
}

function round6(v: number) {
  return Number(v.toFixed(6));
}

function buildSeries() {
  const rows: SeriesPoint[] = [];
  let current = new Date(START_DATE.getTime());

  for (let i = 0; rows.length < 980; i += 1) {
    const day = current.getUTCDay();

    if (day !== 0 && day !== 6) {
      const base = 4.355;
      const longWave = Math.sin(i / 37) * 0.047;
      const shortWave = Math.cos(i / 13) * 0.012;
      const drift = (i / 980) * 0.035;
      const correction = i > 560 ? -0.00009 * (i - 560) : 0;
      const localShock = Math.sin(i / 5.5) * 0.0045;

      rows.push({
        date: dateToString(current),
        value: round4(base + longWave + shortWave + drift + correction + localShock),
      });
    }

    current = addDays(current, 1);
  }

  return rows;
}

export const mockSeries = buildSeries();

const lastPoint = mockSeries[mockSeries.length - 1];
const prevPoint = mockSeries[mockSeries.length - 2];
const delta = round4(lastPoint.value - prevPoint.value);
const deltaPct = Number(((delta / prevPoint.value) * 100).toFixed(2));

function metric(mae: number, rmse: number, mape: number, dirAcc: number, bias = 0.0003) {
  return {
    mae: round6(mae),
    rmse: round6(rmse),
    mape_pct: round6(mape),
    smape_pct: round6(mape * 0.98),
    bias: round6(bias),
    dir_acc: round6(dirAcc),
    MAE: round6(mae),
    RMSE: round6(rmse),
    MAPE: round6(mape),
    MAPE_pct: round6(mape),
    SMAPE: round6(mape * 0.98),
    BIAS: round6(bias),
    DIR_ACC: round6(dirAcc),
  };
}

const baseH30Models: Record<string, any> = {
  Naive: { val: metric(0.0308, 0.0398, 0.71, 0.51), test: metric(0.0316, 0.0407, 0.73, 0.52) },
  SMA: { val: metric(0.0297, 0.0383, 0.69, 0.52), test: metric(0.0302, 0.0391, 0.70, 0.53) },
  EMA: { val: metric(0.0291, 0.0376, 0.67, 0.53), test: metric(0.0298, 0.0384, 0.69, 0.54) },
  Ridge: { val: metric(0.0278, 0.0361, 0.64, 0.55), test: metric(0.0284, 0.0368, 0.66, 0.55) },
  ElasticNet: { val: metric(0.0273, 0.0354, 0.63, 0.56), test: metric(0.0281, 0.0361, 0.65, 0.56) },
  RandomForest: { val: metric(0.0269, 0.0348, 0.62, 0.57), test: metric(0.0274, 0.0353, 0.63, 0.58) },
  ExtraTrees: { val: metric(0.0263, 0.0341, 0.61, 0.59), test: metric(0.0268, 0.0347, 0.62, 0.59) },
  HistGB: { val: metric(0.0270, 0.0350, 0.62, 0.57), test: metric(0.0277, 0.0358, 0.64, 0.57) },
  SARIMAX: { val: metric(0.0288, 0.0372, 0.67, 0.53), test: metric(0.0295, 0.0381, 0.68, 0.54) },
  MLPRegressor: { val: metric(0.0332, 0.0441, 0.77, 0.49), test: metric(0.0348, 0.0457, 0.80, 0.49) },
};

function horizonFactor(h: number) {
  if (h <= 1) return 0.45;
  if (h <= 7) return 0.68;
  if (h <= 30) return 1;
  if (h <= 90) return 1.62;
  if (h <= 180) return 2.18;
  return 3.05;
}

function bestModelForHorizon(h: number) {
  if (h <= 7) return "ElasticNet";
  if (h <= 180) return "ExtraTrees";
  return "Naive";
}

function horizonNode(h: number) {
  const factor = horizonFactor(h);
  const models: Record<string, any> = {};

  for (const [name, pack] of Object.entries(baseH30Models)) {
    models[name] = {
      val: metric(
        pack.val.mae * factor,
        pack.val.rmse * factor,
        pack.val.mape_pct * factor,
        Math.max(0.47, pack.val.dir_acc - Math.max(0, factor - 1) * 0.025),
        pack.val.bias * factor
      ),
      test: metric(
        pack.test.mae * factor,
        pack.test.rmse * factor,
        pack.test.mape_pct * factor,
        Math.max(0.46, pack.test.dir_acc - Math.max(0, factor - 1) * 0.025),
        pack.test.bias * factor
      ),
    };
  }

  return {
    best_model: bestModelForHorizon(h),
    W_used: h <= 7 ? 30 : h <= 30 ? 60 : h <= 90 ? 120 : h <= 180 ? 180 : 260,
    dataset_path: `demo/data/ds_H${h}.csv`,
    baseline_choice: { SMA: h <= 30 ? 10 : 20, EMA: 20 },
    models,
    baseline: models.Naive.test,
    naive: models.Naive.test,
    sma: models.SMA.test,
    ema: models.EMA.test,
    ridge: models.Ridge.test,
    elastic: models.ElasticNet.test,
    rf: models.RandomForest.test,
    extra: models.ExtraTrees.test,
    hgb: models.HistGB.test,
    sarimax: models.SARIMAX.test,
    mlp: models.MLPRegressor.test,
  };
}

const byHorizon: Record<string, any> = {};
for (const h of HORIZONS) byHorizon[String(h)] = horizonNode(h);

export const mockMetrics = {
  best_model: { name: "ExtraTrees" },
  best_model_name: "ExtraTrees",
  by_horizon: byHorizon,
  byHorizon,
  models: {
    baseline_persistence: { val: baseH30Models.Naive.val, test: baseH30Models.Naive.test },
    baseline_ma5: { val: baseH30Models.SMA.val, test: baseH30Models.SMA.test },
    baseline_momentum: { val: metric(0.0312, 0.0402, 0.72, 0.51), test: metric(0.0320, 0.0415, 0.74, 0.51) },
    ridge_delta: { val: baseH30Models.Ridge.val, test: baseH30Models.Ridge.test },
    random_forest_delta: { val: baseH30Models.RandomForest.val, test: baseH30Models.RandomForest.test },
    extra_trees_delta: { val: baseH30Models.ExtraTrees.val, test: baseH30Models.ExtraTrees.test },
    hist_gb_delta: { val: baseH30Models.HistGB.val, test: baseH30Models.HistGB.test },
  },
  params: {
    ridge_best: { "model__alpha": 0.03 },
    rf_best: { n_estimators: 600, max_depth: 8, min_samples_leaf: 2, max_features: "sqrt" },
    et_best: { n_estimators: 900, max_depth: 12, min_samples_leaf: 2, max_features: 0.8 },
    hgb_best: { learning_rate: 0.03, max_iter: 400, max_depth: 4, l2_regularization: 0.01 },
  },
  summary: {
    generated_at: "2026-06-06T15:42:00Z",
  },
};

export const mockRunConfig = {
  pair: "EUR/PLN",
  target: "EUR/PLN rate at forecast horizon H",
  date_range: { start: "2022-01-03", end: lastPoint.date },
  horizons_H: HORIZONS,
  window_mode: "auto",
  window_by_horizon: { "1": 20, "7": 30, "30": 60, "90": 120, "180": 180, "365": 260 },
  split: {
    train: { start: "2022-01-03", end: "2025-04-30" },
    val: { start: "2025-05-01", end: "2025-10-31" },
    test: { start: "2025-11-03", end: lastPoint.date },
    val_size: 130,
    test_size: 260,
  },
  sizes: {
    n_train: 590,
    n_val: 130,
    n_test: 260,
  },
  training: {
    no_tuning: false,
    cv_splits: 5,
  },
  backtest: {
    enabled: true,
    windows: 5,
  },
  viz: {
    zoom_window_days: 90,
  },
  tuning_enabled: true,
  zoom_window_days: 90,
  seed: 123,
  features: [
    "lag_1",
    "lag_2",
    "lag_5",
    "lag_10",
    "lag_20",
    "logret_1",
    "sma_5",
    "sma_10",
    "sma_20",
    "ema_10",
    "ema_20",
    "std_20",
    "dow",
    "month",
    "target_dow",
    "target_month",
  ],
  models_enabled: MODEL_NAMES,
};

export const mockResults = {
  lastRate: {
    date: lastPoint.date,
    value: lastPoint.value,
    prevValue: prevPoint.value,
    delta,
    deltaPct,
  },
  runConfig: mockRunConfig,
  metrics: mockMetrics,
  summary: {
    pair: "EUR/PLN",
    generated_at: "2026-06-06T15:42:00Z",
    horizons: HORIZONS,
    best_model_by_horizon: {
      "1": "ElasticNet",
      "7": "ElasticNet",
      "30": "ExtraTrees",
      "90": "ExtraTrees",
      "180": "ExtraTrees",
      "365": "Naive",
    },
    run_dir: "demo/mock-run-2026-06-06",
  },
  forecast7: [],
  forecast30: [],
  forecast90: [],
  forecast180: [],
  forecast365: [],
  updatedAt: "2026-06-06T15:42:00Z",
  runDir: "demo/mock-run-2026-06-06",
};

export function getMockSeries(days = 3650) {
  return mockSeries.slice(-days);
}

export function getMockData(limit = 500) {
  return mockSeries.slice(-limit);
}

function futureBaseValue(step: number, h: number) {
  const latest = lastPoint.value;
  const drift = h <= 30 ? 0.00055 * step : 0.00105 * step;
  const wave = Math.sin(step / 3 + h / 31) * 0.0075;
  const longWave = Math.cos(step / 9 + h / 50) * 0.004;
  return latest + drift + wave + longWave;
}

export function getMockForecast(h = 30) {
  const rows = [];
  const start = new Date(`${lastPoint.date}T00:00:00Z`);
  const points = h <= 7 ? 14 : h <= 30 ? 30 : h <= 90 ? 36 : h <= 180 ? 42 : 52;
  const targetDate = dateToString(addBusinessDays(start, h));

  for (let i = 1; i <= points; i += 1) {
    const currentForecastDate = dateToString(addBusinessDays(start, i));
    const base = futureBaseValue(i, h);
    const uncertainty = 0.014 + Math.sqrt(h) * 0.0024 + i * 0.00018;

    rows.push({
      H: h,
      date: currentForecastDate,
      forecast_target_date: targetDate,
      latest_observation_date: lastPoint.date,
      latest_value: lastPoint.value,
      baseline: round4(lastPoint.value),
      naive: round4(lastPoint.value),
      sma: round4(base - 0.0065),
      ema: round4(base - 0.0032),
      ridge: round4(base + 0.0018),
      elastic: round4(base + 0.0012),
      rf: round4(base + 0.0038),
      extra: round4(base + 0.0025),
      hgb: round4(base + 0.0032),
      sarimax: round4(base - 0.0017),
      mlp: round4(base + 0.0105),
      xgb: round4(base + 0.0031),
      lgbm: round4(base + 0.0029),
      best_value: round4(base + (bestModelForHorizon(h) === "Naive" ? 0 : 0.0025)),
      best_model: bestModelForHorizon(h),
      p80_low: round4(base - uncertainty),
      p80_high: round4(base + uncertainty),
      p95_low: round4(base - uncertainty * 1.75),
      p95_high: round4(base + uncertainty * 1.75),
    });
  }

  return rows;
}

export function getMockPredictions(h = 30, limit?: number): PredictionRow[] {
  const offset = h <= 1 ? 1 : h <= 7 ? 5 : h <= 30 ? 22 : h <= 90 ? 64 : h <= 180 ? 128 : 250;
  const source = mockSeries.slice(-(offset + 360));
  const rows: PredictionRow[] = [];

  for (let i = 0; i < source.length - offset; i += 1) {
    const current = source[i];
    const target = source[i + offset];
    const phase = i / 8;
    const trueTarget = target.value;
    const naive = current.value;
    const sma = current.value + Math.sin(phase) * (0.004 + h * 0.00003);
    const ema = current.value + Math.cos(phase) * (0.0035 + h * 0.00002);
    const ridge = trueTarget + Math.sin(phase + 0.8) * (0.006 + h * 0.00011);
    const elastic = trueTarget + Math.sin(phase + 1.0) * (0.0055 + h * 0.00010);
    const rf = trueTarget + Math.sin(phase + 1.1) * (0.005 + h * 0.00009);
    const extra = trueTarget + Math.sin(phase + 1.3) * (0.0045 + h * 0.00008);
    const hgb = trueTarget + Math.cos(phase + 0.6) * (0.0053 + h * 0.000095);
    const sarimax = trueTarget + Math.sin(phase + 2.3) * (0.0064 + h * 0.00012);
    const mlp = trueTarget + Math.cos(phase + 1.8) * (0.008 + h * 0.00018);
    const momentum = current.value + (i > 0 ? current.value - source[i - 1].value : 0);
    const bestModel = bestModelForHorizon(h);
    const bestValue = bestModel === "Naive" ? naive : bestModel === "ElasticNet" ? elastic : extra;

    rows.push({
      date: current.date,
      target_date: target.date,
      y_t: current.value,
      true_target: trueTarget,
      true_tomorrow: trueTarget,
      best_model: bestModel,
      pred_best: round4(bestValue),
      pred_baseline: round4(naive),
      pred_naive: round4(naive),
      pred_ma5: round4(sma),
      pred_sma: round4(sma),
      pred_ema: round4(ema),
      pred_momentum: round4(momentum),
      pred_ridge: round4(ridge),
      pred_elastic: round4(elastic),
      pred_rf: round4(rf),
      pred_extra: round4(extra),
      pred_hgb: round4(hgb),
      pred_sarimax: round4(sarimax),
      pred_mlp: round4(mlp),
      pred_xgb: round4(hgb - 0.001),
      pred_lgbm: round4(extra + 0.0008),
    });
  }

  return typeof limit === "number" && limit > 0 ? rows.slice(-limit) : rows;
}

export const mockLogs = `2026-06-06 15:42:00 | INFO | DEMO MODE enabled
2026-06-06 15:42:01 | INFO | Loaded mocked EUR/PLN series
2026-06-06 15:42:02 | INFO | Built demo datasets for H=1,7,30,90,180,365
2026-06-06 15:42:03 | INFO | Generated mock predictions for all enabled models
2026-06-06 15:42:04 | INFO | Generated mock error distributions and model metrics
2026-06-06 15:42:05 | INFO | Backend pipeline is disabled on GitHub Pages
2026-06-06 15:42:06 | INFO | Demo is ready`;
