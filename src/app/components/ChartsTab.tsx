import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

type Row = { date: string; true: number; baseline: number; ridge: number; rf: number; errBaseline: number; errRidge: number; errRf: number };

function fmt(x: number | null | undefined, d = 4) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(d).replace(".", ",");
}

function r2Score(y: number[], yhat: number[]) {
  if (y.length === 0) return null;
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const sst = y.reduce((a, b) => a + (b - mean) ** 2, 0);
  const sse = y.reduce((a, b, i) => a + (b - yhat[i]) ** 2, 0);
  if (sst === 0) return null;
  return 1 - sse / sst;
}

export default function ChartsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [metrics, setMetrics] = useState<any>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.predictionsTest(140);
        setRows(r.rows);

        const res = await api.results();
        setMetrics(res.metrics ?? {});
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  // pick best model by MAE
  const modelCandidates = useMemo(() => {
    const b = metrics?.baseline_persistence;
    const rd = metrics?.ridge_delta;
    const rf = metrics?.random_forest_delta;

    const list = [
      { key: "baseline", name: "Baseline", mae: b?.MAE, rmse: b?.RMSE, mape: b?.MAPE_pct },
      { key: "ridge", name: "Ridge", mae: rd?.MAE, rmse: rd?.RMSE, mape: rd?.MAPE_pct },
      { key: "rf", name: "Random Forest", mae: rf?.MAE, rmse: rf?.RMSE, mape: rf?.MAPE_pct },
    ].filter((x) => typeof x.mae === "number");

    if (!list.length) return null;
    return list.sort((a, b) => (a.mae as number) - (b.mae as number))[0];
  }, [metrics]);

  const bestKey = modelCandidates?.key ?? "ridge";
  const y = rows.map((r) => r.true);
  const yhat = rows.map((r) => (bestKey === "baseline" ? r.baseline : bestKey === "rf" ? r.rf : r.ridge));
  const r2 = r2Score(y, yhat);

  const comparisonData = useMemo(() => rows.map((r) => ({
    date: r.date,
    actual: r.true,
    predicted: bestKey === "baseline" ? r.baseline : bestKey === "rf" ? r.rf : r.ridge,
  })), [rows, bestKey]);

  const residualData = useMemo(() => rows.map((r) => ({
    date: r.date,
    residual: bestKey === "baseline" ? r.errBaseline : bestKey === "rf" ? r.errRf : r.errRidge,
  })), [rows, bestKey]);

  return (
    <div className="space-y-6">
      <h2>Wykresy analizy</h2>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      {/* Actual vs Predicted */}
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">
          Porównanie: wartości rzeczywiste vs predykcje ({modelCandidates?.name ?? "—"})
        </h3>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={comparisonData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(0, 0, 0, 0.9)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                color: "#fff",
                backdropFilter: "blur(12px)",
              }}
            />
            <Line type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} dot={false} name="Rzeczywiste" />
            <Line type="monotone" dataKey="predicted" stroke="#ec4899" strokeWidth={2} dot={false} name="Predykcje" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Residuals */}
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">Reszty (pred - true) — {modelCandidates?.name ?? "—"}</h3>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={residualData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(0, 0, 0, 0.9)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                color: "#fff",
                backdropFilter: "blur(12px)",
              }}
            />
            <Line type="monotone" dataKey="residual" stroke="#22c55e" strokeWidth={2} dot={false} name="Reszty" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Statistics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <h3 className="mb-4">Statystyki błędów (best)</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">MAE:</span>
              <span>{modelCandidates?.mae === undefined ? "—" : fmt(modelCandidates.mae, 6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">RMSE:</span>
              <span>{modelCandidates?.rmse === undefined ? "—" : fmt(modelCandidates.rmse, 6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">MAPE:</span>
              <span>{modelCandidates?.mape === undefined ? "—" : `${fmt(modelCandidates.mape, 2)}%`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">R² (obliczone):</span>
              <span>{r2 === null ? "—" : fmt(r2, 4)}</span>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <h3 className="mb-4">Informacje o modelu</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Model:</span>
              <span>{modelCandidates?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Okres testowy:</span>
              <span>{rows.length ? `${rows[0].date} — ${rows[rows.length - 1].date}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Liczba cech:</span>
              <span>{Array.isArray(metrics?.features) ? metrics.features.length : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Liczba próbek test:</span>
              <span>{rows.length || "—"}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
