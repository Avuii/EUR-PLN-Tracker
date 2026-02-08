import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { api } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

type ErrRow = { date: string; baseline: number; ridge: number; rf: number };

function fmt(x: number | null | undefined, d = 6) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(d).replace(".", ",");
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const date = payload[0]?.payload?.date ?? "";
    return (
      <div className="bg-[#2a2f4a] border border-gray-700 rounded p-3 text-xs">
        <div className="mb-2">{date}</div>
        {payload.map((entry: any, index: number) => (
          <div key={index} style={{ color: entry.color }}>
            {entry.name}: {entry.value === null || entry.value === undefined ? "—" : fmt(entry.value, 6)}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function ModelErrorsTab() {
  const [data, setData] = useState<ErrRow[]>([]);
  const [metrics, setMetrics] = useState<any>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.errorsTest(0);
        setData(r.rows);

        const res = await api.results();
        setMetrics(res.metrics ?? {});
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  const last = data.length ? data[data.length - 1] : null;

  const mBase = metrics?.baseline_persistence;
  const mRidge = metrics?.ridge_delta;
  const mRf = metrics?.random_forest_delta;

  // best by MAE
  const best = useMemo(() => {
    const list = [
      { name: "Baseline", m: mBase },
      { name: "Ridge", m: mRidge },
      { name: "Random Forest", m: mRf },
    ].filter((x) => typeof x.m?.MAE === "number");
    if (!list.length) return null;
    return list.sort((a, b) => (a.m.MAE as number) - (b.m.MAE as number))[0];
  }, [mBase, mRidge, mRf]);

  return (
    <div className="space-y-6">
      <h2>Wykres błędów (pred - true)</h2>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      {/* Error Chart */}
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <div className="mb-4">
          <div className="inline-block bg-white/5 border border-white/10 rounded-xl p-3 text-xs backdrop-blur-sm">
            <div className="mb-1">{last?.date ?? "—"}</div>
            <div className="text-gray-400">— Błąd Baseline : {last ? fmt(last.baseline, 6) : "—"}</div>
            <div className="text-gray-400">— Błąd Ridge : {last ? fmt(last.ridge, 6) : "—"}</div>
            <div className="text-gray-400">— Błąd RF : {last ? fmt(last.rf, 6) : "—"}</div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} strokeDasharray="3 3" />
            <Line type="monotone" dataKey="baseline" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Błąd Baseline" />
            <Line type="monotone" dataKey="ridge" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Błąd Ridge" />
            <Line type="monotone" dataKey="rf" stroke="#eab308" strokeWidth={1.5} dot={false} name="Błąd RF" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Error Metrics */}
      <div>
        <h3 className="mb-4">Analiza błędów — metryki</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/[0.02] border-purple-500/20 p-5 rounded-2xl backdrop-blur-xl shadow-xl shadow-purple-500/5">
            <h4 className="text-sm mb-4 text-purple-400">Baseline (persistence)</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">MAE:</span>
                <span>{mBase ? fmt(mBase.MAE, 6) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">RMSE:</span>
                <span>{mBase ? fmt(mBase.RMSE, 6) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">MAPE:</span>
                <span>{mBase ? `${fmt(mBase.MAPE_pct, 2)}%` : "—"}</span>
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/[0.02] border-cyan-500/20 p-5 rounded-2xl backdrop-blur-xl shadow-xl shadow-cyan-500/5">
            <h4 className="text-sm mb-4 text-cyan-400">Ridge</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">MAE:</span>
                <span>{mRidge ? fmt(mRidge.MAE, 6) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">RMSE:</span>
                <span>{mRidge ? fmt(mRidge.RMSE, 6) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">MAPE:</span>
                <span>{mRidge ? `${fmt(mRidge.MAPE_pct, 2)}%` : "—"}</span>
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/10 to-green-500/[0.02] border-green-500/20 p-5 rounded-2xl backdrop-blur-xl shadow-xl shadow-green-500/5">
            <h4 className="text-sm mb-4 text-green-400">Random Forest</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">MAE:</span>
                <span>{mRf ? fmt(mRf.MAE, 6) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">RMSE:</span>
                <span>{mRf ? fmt(mRf.RMSE, 6) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">MAPE:</span>
                <span>{mRf ? `${fmt(mRf.MAPE_pct, 2)}%` : "—"}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Prediction Quality */}
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">Jakość predykcji</h3>
        <div className="text-sm text-gray-400 space-y-2">
          <p>
            Najlepszy model według MAE: <span className="text-cyan-400">{best?.name ?? "—"}</span>.
          </p>
          <p>
            Jeśli błędy oscylują wokół zera i nie “uciekają” w jedną stronę, to zwykle oznacza brak systematycznego odchylenia.
          </p>
          <p>
            Wykres powyżej pokazuje błędy (pred - true) na zbiorze testowym z pliku <span className="font-mono">predictions_test.csv</span>.
          </p>
        </div>
      </Card>
    </div>
  );
}
