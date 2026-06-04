import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, PredictionsTestRow } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

const HORIZONS = [1, 7, 30, 90, 180, 365];

const MODEL_OPTS = [
  { key: "pred_best", label: "Best model", metricName: null },
  { key: "pred_naive", label: "Naive", metricName: "Naive" },
  { key: "pred_sma", label: "SMA", metricName: "SMA" },
  { key: "pred_ema", label: "EMA", metricName: "EMA" },
  { key: "pred_ridge", label: "Ridge", metricName: "Ridge" },
  { key: "pred_elastic", label: "ElasticNet", metricName: "ElasticNet" },
  { key: "pred_rf", label: "RandomForest", metricName: "RandomForest" },
  { key: "pred_extra", label: "ExtraTrees", metricName: "ExtraTrees" },
  { key: "pred_hgb", label: "HistGB", metricName: "HistGB" },
  { key: "pred_sarimax", label: "SARIMAX", metricName: "SARIMAX" },
  { key: "pred_mlp", label: "MLPRegressor", metricName: "MLPRegressor" },
];

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatNum(v: any) {
  const n = toNum(v);
  if (n === null) return "—";
  return n.toFixed(4).replace(".", ",");
}

function formatPct(v: any) {
  const n = toNum(v);
  if (n === null) return "—";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

function getHorizonMetrics(metrics: any, horizon: number) {
  return metrics?.by_horizon?.[String(horizon)] ?? metrics?.byHorizon?.[String(horizon)] ?? null;
}

function getMetricPack(metrics: any, horizon: number, selectedKey: string) {
  const node = getHorizonMetrics(metrics, horizon);
  if (!node) return null;

  const bestModel = node?.best_model;
  const opt = MODEL_OPTS.find((x) => x.key === selectedKey);
  const modelName = opt?.metricName ?? bestModel;
  const root = node?.models?.[modelName]?.test ?? node?.models?.[modelName]?.val ?? null;

  if (!root) return null;

  return {
    mae: toNum(root.mae ?? root.MAE),
    rmse: toNum(root.rmse ?? root.RMSE),
    mape: toNum(root.mape_pct ?? root.MAPE ?? root.MAPE_pct),
    dirAcc: toNum(root.dir_acc ?? root.DIR_ACC),
    modelName,
  };
}

export default function ChartsTab() {
  const [horizon, setHorizon] = useState<number>(30);
  const [modelKey, setModelKey] = useState<string>("pred_best");
  const [limit, setLimit] = useState<number>(260);
  const [predRows, setPredRows] = useState<PredictionsTestRow[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const [res, preds] = await Promise.all([api.results(), api.predictionsTest(limit, horizon)]);
        if (!alive) return;

        setMetrics(res?.metrics ?? null);
        setPredRows(preds ?? []);
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message ?? e));
        setPredRows([]);
        setMetrics(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [limit, horizon]);

  const availableOptions = useMemo(() => {
    return MODEL_OPTS.filter((opt) => opt.key === "pred_best" || predRows.some((row) => toNum(row[opt.key]) !== null));
  }, [predRows]);

  useEffect(() => {
    if (!availableOptions.some((opt) => opt.key === modelKey)) {
      setModelKey(availableOptions[0]?.key ?? "pred_best");
    }
  }, [availableOptions, modelKey]);

  const selectedLabel = useMemo(() => {
    return MODEL_OPTS.find((o) => o.key === modelKey)?.label ?? modelKey;
  }, [modelKey]);

  const lineData = useMemo(() => {
    return predRows.map((row) => {
      const trueVal = toNum(row.true_target ?? row.true_tomorrow);
      const predVal = toNum(row[modelKey]);

      return {
        date: String(row.target_date ?? row.date),
        true: trueVal,
        pred: predVal,
      };
    });
  }, [predRows, modelKey]);

  const yDomain = useMemo(() => yDomainFromData(lineData, ["true", "pred"], 0.08, 0.01), [lineData]);

  const scatterData = useMemo(() => {
    return lineData
      .filter((d) => toNum(d.true) !== null && toNum(d.pred) !== null)
      .map((d) => ({ x: Number(d.true), y: Number(d.pred) }));
  }, [lineData]);

  const scatterDomain = useMemo(() => yDomainFromData(scatterData, ["x", "y"], 0.08, 0.01), [scatterData]);
  const metricPack = useMemo(() => getMetricPack(metrics, horizon, modelKey), [metrics, horizon, modelKey]);

  return (
    <div className="app-page space-y-6">
      <Card className="premium-card rounded-3xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl text-white">Ewaluacja</CardTitle>
        </CardHeader>

        <CardContent className="app-page space-y-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <div className="mb-1 text-sm text-slate-300">Horyzont</div>
              <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
                <SelectTrigger className="app-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#070b16] text-white">
                  {HORIZONS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      H={h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm text-slate-300">Model</div>
              <Select value={modelKey} onValueChange={setModelKey}>
                <SelectTrigger className="app-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#070b16] text-white">
                  {availableOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm text-slate-300">Limit próbek testowych</div>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="app-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#070b16] text-white">
                  {[120, 260, 400, 800].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <div className="w-full rounded-3xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-slate-300">
                True vs predicted dla test set. Dane są mapowane z aktualnego formatu backendu.
              </div>
            </div>
          </div>

          {err ? (
            <div className="rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              Błąd: {err}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Test MAE</div>
              <div className="mt-2 text-xl font-semibold text-white">{formatNum(metricPack?.mae)}</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Test RMSE</div>
              <div className="mt-2 text-xl font-semibold text-white">{formatNum(metricPack?.rmse)}</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Test MAPE</div>
              <div className="mt-2 text-xl font-semibold text-white">{formatPct(metricPack?.mape)}</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Model</div>
              <div className="mt-2 text-xl font-semibold text-white">{metricPack?.modelName ?? selectedLabel}</div>
            </div>
          </div>

          <div className="h-[420px] w-full rounded-3xl border border-white/10 bg-black/25 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 18, right: 18, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis domain={yDomain} tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#070b16", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", color: "#fff" }}
                  formatter={(val: any, name: any) => [formatNum(val), name === "true" ? "True" : `Pred (${selectedLabel})`]}
                  labelFormatter={(l) => `Data: ${l}`}
                />
                <Legend wrapperStyle={{ color: "#e5e7eb" }} />
                <Line type="monotone" dataKey="true" dot={false} strokeWidth={2.2} stroke="#94a3b8" name="True" />
                <Line type="monotone" dataKey="pred" dot={false} strokeWidth={2.5} stroke="#22d3ee" name={`Pred (${selectedLabel})`} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[360px] w-full rounded-3xl border border-white/10 bg-black/25 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 18, left: 18, bottom: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" opacity={0.35} />
                <XAxis type="number" dataKey="x" name="True" tick={{ fontSize: 12, fill: "#9ca3af" }} domain={scatterDomain} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis type="number" dataKey="y" name="Pred" tick={{ fontSize: 12, fill: "#9ca3af" }} domain={scatterDomain} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#070b16", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", color: "#fff" }}
                  formatter={(val: any, name: any) => [formatNum(val), name === "x" ? "True" : "Pred"]}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                <ReferenceLine segment={[{ x: scatterDomain[0], y: scatterDomain[0] }, { x: scatterDomain[1], y: scatterDomain[1] }]} stroke="rgba(255,255,255,0.35)" strokeDasharray="4 4" />
                <Scatter name={`Pred vs True (${selectedLabel})`} data={scatterData} fill="#22d3ee" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {loading ? <div className="text-sm text-slate-400">Ładowanie…</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
