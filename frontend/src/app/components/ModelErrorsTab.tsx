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

const HORIZONS = [1, 7, 30, 90, 180, 365];

const MODEL_OPTS = [
  { key: "pred_best", label: "Best model" },
  { key: "pred_naive", label: "Naive" },
  { key: "pred_sma", label: "SMA" },
  { key: "pred_ema", label: "EMA" },
  { key: "pred_ridge", label: "Ridge" },
  { key: "pred_elastic", label: "ElasticNet" },
  { key: "pred_rf", label: "RandomForest" },
  { key: "pred_extra", label: "ExtraTrees" },
  { key: "pred_hgb", label: "HistGB" },
  { key: "pred_sarimax", label: "SARIMAX" },
  { key: "pred_mlp", label: "MLPRegressor" },
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
    return { bin: `${x0.toFixed(4)}…${x1.toFixed(4)}`.replace(/\./g, ","), count };
  });
}

export default function ModelErrorsTab() {
  const [horizon, setHorizon] = useState<number>(30);
  const [modelKey, setModelKey] = useState<string>("pred_best");
  const [limit, setLimit] = useState<number>(260);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const r = await api.errorsTest(modelKey, limit, horizon);
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
  }, [modelKey, limit, horizon]);

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
    () => rows.map((r) => ({ date: r.date, error: typeof r.error === "number" && Number.isFinite(r.error) ? r.error : null })),
    [rows]
  );

  const yDomain = useMemo(() => yDomainSymmetric(lineData, ["error"], 0.12, 0.01), [lineData]);
  const histData = useMemo(() => histogram(cleanErrors, 26), [cleanErrors]);

  const top10 = useMemo(() => {
    return rows
      .filter((r) => typeof r.abs_error === "number" && Number.isFinite(r.abs_error))
      .slice()
      .sort((a, b) => (b.abs_error as number) - (a.abs_error as number))
      .slice(0, 10);
  }, [rows]);

  const modelLabel = useMemo(() => MODEL_OPTS.find((o) => o.key === modelKey)?.label ?? modelKey, [modelKey]);

  return (
    <div className="app-page space-y-6">
      <Card className="premium-card rounded-3xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl text-white">Analiza błędów</CardTitle>
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
                  {MODEL_OPTS.map((o) => (
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

            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">Reszty ({modelLabel})</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
                <div>Średnia: <span className="font-semibold text-white">{formatNum(stats.mean)}</span></div>
                <div>σ: <span className="font-semibold text-white">{formatNum(stats.std)}</span></div>
                <div>Min: <span className="font-semibold text-white">{formatNum(stats.min)}</span></div>
                <div>Max: <span className="font-semibold text-white">{formatNum(stats.max)}</span></div>
              </div>
            </div>
          </div>

          {err ? (
            <div className="rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              Błąd: {err}
            </div>
          ) : null}

          <div className="h-[420px] w-full rounded-3xl border border-white/10 bg-black/25 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 18, right: 18, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis domain={yDomain} tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#070b16", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", color: "#fff" }}
                  formatter={(val: any, name: any) => [formatNum(val), name === "error" ? "Błąd (pred - true)" : String(name)]}
                  labelFormatter={(l) => `Data: ${l}`}
                />
                <Legend wrapperStyle={{ color: "#e5e7eb" }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" strokeOpacity={0.7} />
                <ReferenceLine y={stats.mean} stroke="rgba(255,255,255,0.3)" strokeOpacity={0.5} strokeDasharray="5 5" />
                <ReferenceLine y={stats.mean + 2 * stats.std} stroke="rgba(255,255,255,0.25)" strokeOpacity={0.4} strokeDasharray="6 6" />
                <ReferenceLine y={stats.mean - 2 * stats.std} stroke="rgba(255,255,255,0.25)" strokeOpacity={0.4} strokeDasharray="6 6" />
                <Line type="monotone" dataKey="error" dot={false} strokeWidth={2.5} stroke="#22d3ee" name="Błąd (pred - true)" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[320px] w-full rounded-3xl border border-white/10 bg-black/25 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 18, right: 18, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" opacity={0.35} />
                <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={4} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <Tooltip contentStyle={{ backgroundColor: "#070b16", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", color: "#fff" }} />
                <Bar dataKey="count" name="Liczność" fill="#22d3ee" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/25">
            <div className="border-b border-white/10 bg-black/35 px-4 py-3 text-sm font-medium text-white">
              Top 10 największych błędów
            </div>
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-black/60 backdrop-blur-xl">
                  <tr className="text-left">
                    <th className="border-b border-white/10 px-3 py-2 text-slate-300">Data</th>
                    <th className="border-b border-white/10 px-3 py-2 text-slate-300">Pred</th>
                    <th className="border-b border-white/10 px-3 py-2 text-slate-300">Error</th>
                    <th className="border-b border-white/10 px-3 py-2 text-slate-300">|Error|</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td className="px-3 py-3 text-slate-400" colSpan={4}>Ładowanie…</td></tr>
                  ) : null}

                  {!loading && !top10.length ? (
                    <tr><td className="px-3 py-3 text-slate-400" colSpan={4}>Brak danych.</td></tr>
                  ) : null}

                  {!loading && top10.map((r, i) => (
                    <tr key={i} className="border-t border-white/5 transition-colors hover:bg-white/5">
                      <td className="px-3 py-2 font-mono text-white">{r.date}</td>
                      <td className="px-3 py-2 font-mono text-white">{formatNum(r.pred)}</td>
                      <td className="px-3 py-2 font-mono text-white">{formatNum(r.error)}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{formatNum(r.abs_error)}</td>
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
