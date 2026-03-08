// src/components/ChartsTab.tsx
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

type ModelOption = {
  key: string;
  label: string;
  metricKey?: string;
  metricAliasKey?: string;
};

type MetricPack = {
  MAE: number;
  RMSE: number;
  MAPE: number;
};

const MODEL_OPTS: ModelOption[] = [
  { key: "pred_baseline", label: "Baseline", metricKey: "baseline_persistence", metricAliasKey: "baseline" },
  { key: "pred_ma5", label: "MA(5)", metricKey: "baseline_ma5", metricAliasKey: "ma5" },
  { key: "pred_momentum", label: "Momentum", metricKey: "baseline_momentum", metricAliasKey: "momentum" },
  { key: "pred_ridge", label: "Ridge (delta)", metricKey: "ridge_delta", metricAliasKey: "ridge" },
  { key: "pred_rf", label: "RandomForest (delta)", metricKey: "random_forest_delta", metricAliasKey: "rf" },
  { key: "pred_extra", label: "ExtraTrees (delta)", metricKey: "extra_trees_delta", metricAliasKey: "extra" },
  { key: "pred_hgb", label: "HistGB (delta)", metricKey: "hist_gb_delta", metricAliasKey: "hgb" },
  { key: "pred_best", label: "Best model", metricAliasKey: "best_model_name" },
];

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatNum(v: any) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(".", ",");
}

function formatPct(v: any) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

function normalizeMetricPack(v: any): MetricPack | null {
  if (!v || typeof v !== "object") return null;

  const root = v?.test ?? v?.val ?? v;

  const mae = toNum(root?.MAE ?? root?.mae);
  const rmse = toNum(root?.RMSE ?? root?.rmse);
  const mape = toNum(root?.MAPE ?? root?.MAPE_pct ?? root?.mape ?? root?.mape_pct);

  if (mae === null || rmse === null || mape === null) return null;
  return { MAE: mae, RMSE: rmse, MAPE: mape };
}

function getMetricPack(metrics: any, opt?: ModelOption | null): MetricPack | null {
  if (!metrics || !opt) return null;

  if (opt.metricKey) {
    const fromModels = normalizeMetricPack(metrics?.models?.[opt.metricKey]);
    if (fromModels) return fromModels;
  }

  if (opt.metricAliasKey) {
    const fromAlias = normalizeMetricPack(metrics?.[opt.metricAliasKey]);
    if (fromAlias) return fromAlias;
  }

  return null;
}

export default function ChartsTab() {
  const [modelKey, setModelKey] = useState<string>("pred_rf");
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
        const [res, preds] = await Promise.all([api.results(), api.predictionsTest(limit)]);
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
  }, [limit]);

  const selectedOpt = useMemo(
    () => MODEL_OPTS.find((o) => o.key === modelKey) ?? MODEL_OPTS[0],
    [modelKey]
  );

  const selectedLabel = selectedOpt?.label ?? modelKey;

  const lineData = useMemo(() => {
    return predRows.map((r) => {
      const trueVal = Number(r.true_tomorrow);
      const predValRaw = r?.[modelKey];
      const predVal = predValRaw == null ? null : Number(predValRaw);

      return {
        date: String(r.date),
        true: Number.isFinite(trueVal) ? trueVal : null,
        pred: Number.isFinite(predVal as number) ? predVal : null,
      };
    });
  }, [predRows, modelKey]);

  const yDomain = useMemo(() => {
    return yDomainFromData(lineData, ["true", "pred"], 0.08, 0.01);
  }, [lineData]);

  const scatterData = useMemo(() => {
    return lineData
      .filter((d) => Number.isFinite(d.true as number) && Number.isFinite(d.pred as number))
      .map((d) => ({
        x: Number(d.true),
        y: Number(d.pred),
      }));
  }, [lineData]);

  const scatterDomain = useMemo(() => {
    return yDomainFromData(scatterData, ["x", "y"], 0.08, 0.01);
  }, [scatterData]);

  const metricPack = useMemo(() => {
    return getMetricPack(metrics, selectedOpt);
  }, [metrics, selectedOpt]);

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 rounded-2xl backdrop-blur-xl shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-xl">Ewaluacja</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-sm mb-1 text-gray-300">Model</div>
              <Select value={modelKey} onValueChange={setModelKey}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0b0f19] border-white/10 text-white">
                  {MODEL_OPTS.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm mb-1 text-gray-300">Limit (ostatnie próbki testowe)</div>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0b0f19] border-white/10 text-white">
                  {[120, 260, 400, 800].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <div className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-gray-300">
                True vs Predicted (test set) + scatter z linią y=x
              </div>
            </div>
          </div>

          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-200">
              Błąd: {err}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Test MAE</div>
              <div className="mt-2 text-white text-xl font-semibold">
                {metricPack ? formatNum(metricPack.MAE) : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Test RMSE</div>
              <div className="mt-2 text-white text-xl font-semibold">
                {metricPack ? formatNum(metricPack.RMSE) : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Test MAPE</div>
              <div className="mt-2 text-white text-xl font-semibold">
                {metricPack ? formatPct(metricPack.MAPE) : "—"}
              </div>
            </div>
          </div>

          <div className="h-[420px] w-full rounded-2xl border border-white/10 bg-black/20 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 18, right: 18, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                />
                <YAxis
                  domain={yDomain}
                  tick={{ fontSize: 12, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    color: "#fff",
                  }}
                  formatter={(val: any, name: any) => [
                    formatNum(val),
                    name === "true" ? "True" : `Pred (${selectedLabel})`,
                  ]}
                  labelFormatter={(l) => `Data: ${l}`}
                />
                <Legend wrapperStyle={{ color: "#e5e7eb" }} />
                <Line type="monotone" dataKey="true" dot={false} strokeWidth={2.2} stroke="#94a3b8" name="True" />
                <Line
                  type="monotone"
                  dataKey="pred"
                  dot={false}
                  strokeWidth={2.4}
                  stroke="#22d3ee"
                  name={`Pred (${selectedLabel})`}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[360px] w-full rounded-2xl border border-white/10 bg-black/20 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 18, left: 18, bottom: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" opacity={0.35} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="True"
                  tick={{ fontSize: 12, fill: "#9ca3af" }}
                  domain={scatterDomain}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Pred"
                  tick={{ fontSize: 12, fill: "#9ca3af" }}
                  domain={scatterDomain}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    color: "#fff",
                  }}
                  formatter={(val: any, name: any) => [formatNum(val), name === "x" ? "True" : "Pred"]}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                <ReferenceLine
                  segment={[
                    { x: scatterDomain[0], y: scatterDomain[0] },
                    { x: scatterDomain[1], y: scatterDomain[1] },
                  ]}
                  stroke="rgba(255,255,255,0.35)"
                  strokeDasharray="4 4"
                />
                <Scatter name={`Pred vs True (${selectedLabel})`} data={scatterData} fill="#22d3ee" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {loading && <div className="text-sm text-gray-400">Ładowanie…</div>}
        </CardContent>
      </Card>
    </div>
  );
}