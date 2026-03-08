// src/components/ModelErrorsTab.tsx
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api } from "../lib/api";
import { yDomainSymmetric } from "../lib/chartDomain";

type ModelOpt = { key: string; label: string };

const MODEL_OPTS: ModelOpt[] = [
  { key: "pred_baseline", label: "Baseline" },
  { key: "pred_ma5", label: "MA(5)" },
  { key: "pred_momentum", label: "Momentum" },
  { key: "pred_ridge", label: "Ridge (delta)" },
  { key: "pred_rf", label: "RandomForest (delta)" },
  { key: "pred_extra", label: "ExtraTrees (delta)" },
  { key: "pred_hgb", label: "HistGB (delta)" },
  { key: "pred_best", label: "Best model" },
];

type ErrorRow = {
  date: string;
  true_tomorrow: number | null;
  pred: number | null;
  error: number | null;
  abs_error: number | null;
};

function formatNum(v: any) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(5).replace(".", ",");
}

function meanStd(values: number[]) {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function histogram(values: number[], bins = 24) {
  if (!values.length) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const eps = 1e-12;
  const width = (max - min + eps) / bins;

  const counts = new Array(bins).fill(0);

  for (const x of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((x - min) / width)));
    counts[idx]++;
  }

  return counts.map((count, i) => {
    const x0 = min + i * width;
    const x1 = x0 + width;
    return {
      bin: `${x0.toFixed(4)}…${x1.toFixed(4)}`.replace(/\./g, ","),
      count,
    };
  });
}

export default function ModelErrorsTab() {
  const [modelKey, setModelKey] = useState<string>("pred_rf");
  const [limit, setLimit] = useState<number>(400);

  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const r = await api.errorsTest(modelKey, limit);
        if (!alive) return;
        setRows((r ?? []) as ErrorRow[]);
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message ?? e));
        setRows([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [modelKey, limit]);

  const cleanErrors = useMemo(
    () => rows.map((r) => r.error).filter((x): x is number => typeof x === "number" && Number.isFinite(x)),
    [rows]
  );

  const stats = useMemo(() => {
    const { mean, std } = meanStd(cleanErrors);
    const min = cleanErrors.length ? Math.min(...cleanErrors) : 0;
    const max = cleanErrors.length ? Math.max(...cleanErrors) : 0;
    return { mean, std, min, max };
  }, [cleanErrors]);

  const lineData = useMemo(
    () =>
      rows.map((r) => ({
        date: r.date,
        error: typeof r.error === "number" && Number.isFinite(r.error) ? r.error : null,
      })),
    [rows]
  );

  const yDomain = useMemo(() => {
    return yDomainSymmetric(lineData, ["error"], 0.12, 0.01);
  }, [lineData]);

  const histData = useMemo(() => histogram(cleanErrors, 26), [cleanErrors]);

  const top10 = useMemo(() => {
    return rows
      .filter((r) => typeof r.abs_error === "number" && Number.isFinite(r.abs_error))
      .slice()
      .sort((a, b) => (b.abs_error as number) - (a.abs_error as number))
      .slice(0, 10);
  }, [rows]);

  const modelLabel = useMemo(
    () => MODEL_OPTS.find((o) => o.key === modelKey)?.label ?? modelKey,
    [modelKey]
  );

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 rounded-2xl backdrop-blur-xl shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-xl">Analiza błędów</CardTitle>
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

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">
                Statystyki reszt ({modelLabel})
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-200">
                <div>
                  Średnia: <span className="font-semibold text-white">{formatNum(stats.mean)}</span>
                </div>
                <div>
                  σ: <span className="font-semibold text-white">{formatNum(stats.std)}</span>
                </div>
                <div>
                  Min: <span className="font-semibold text-white">{formatNum(stats.min)}</span>
                </div>
                <div>
                  Max: <span className="font-semibold text-white">{formatNum(stats.max)}</span>
                </div>
              </div>
            </div>
          </div>

          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-200">
              Błąd: {err}
            </div>
          )}

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
                    name === "error" ? "Błąd (pred - true)" : String(name),
                  ]}
                  labelFormatter={(l) => `Data: ${l}`}
                />
                <Legend wrapperStyle={{ color: "#e5e7eb" }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" strokeOpacity={0.7} />
                <ReferenceLine y={stats.mean} stroke="rgba(255,255,255,0.3)" strokeOpacity={0.5} strokeDasharray="5 5" />
                <ReferenceLine
                  y={stats.mean + 2 * stats.std}
                  stroke="rgba(255,255,255,0.25)"
                  strokeOpacity={0.4}
                  strokeDasharray="6 6"
                />
                <ReferenceLine
                  y={stats.mean - 2 * stats.std}
                  stroke="rgba(255,255,255,0.25)"
                  strokeOpacity={0.4}
                  strokeDasharray="6 6"
                />
                <Line
                  type="monotone"
                  dataKey="error"
                  dot={false}
                  strokeWidth={2.4}
                  stroke="#22d3ee"
                  name="Błąd (pred - true)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[320px] w-full rounded-2xl border border-white/10 bg-black/20 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 18, right: 18, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" opacity={0.35} />
                <XAxis
                  dataKey="bin"
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  interval={4}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                />
                <YAxis
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
                />
                <Bar dataKey="count" name="Liczność" fill="#22d3ee" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/20">
            <div className="px-4 py-3 text-sm font-medium border-b border-white/10 bg-black/30 text-white">
              Top 10 największych błędów
            </div>

            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-black/60 backdrop-blur-xl">
                  <tr className="text-left">
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">Data</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">Pred</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">Error</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">|Error|</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={4}>
                        Ładowanie…
                      </td>
                    </tr>
                  )}

                  {!loading && !top10.length && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={4}>
                        Brak danych.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    top10.map((r, i) => (
                      <tr key={i} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2 text-white font-mono">{r.date}</td>
                        <td className="px-3 py-2 text-white font-mono">{formatNum(r.pred)}</td>
                        <td className="px-3 py-2 text-white font-mono">{formatNum(r.error)}</td>
                        <td className="px-3 py-2 text-gray-300 font-mono">{formatNum(r.abs_error)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}