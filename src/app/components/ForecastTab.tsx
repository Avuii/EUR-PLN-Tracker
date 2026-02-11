import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

type PredRow = {
  date: string;
  true: number;
  baseline: number;
  ridge: number;
  rf: number;
};

function fmt4(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(4).replace(".", ",");
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0]?.payload?.date ?? "";
    return (
      <div className="bg-[#2a2f4a] border border-gray-700 rounded p-3 text-xs">
        <div className="mb-2">{d}</div>
        {payload.map((entry: any, index: number) => (
          <div key={index} style={{ color: entry.color }}>
            {entry.name}: {entry.value === null || entry.value === undefined ? "—" : fmt4(entry.value)}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function ForecastTab() {
  const [pred, setPred] = useState<PredRow[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.predictionsTest(0);
        setPred(r.rows as any);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  const zoom90 = useMemo(() => pred.slice(Math.max(0, pred.length - 90)), [pred]);

  const yDomainFull = useMemo(
    () => yDomainFromData(pred, ["true", "baseline", "ridge", "rf"], 0.06, 0.02),
    [pred]
  );
  const yDomainZoom = useMemo(
    () => yDomainFromData(zoom90, ["true", "baseline", "ridge", "rf"], 0.06, 0.02),
    [zoom90]
  );

  const last = pred.length ? pred[pred.length - 1] : null;

  return (
    <div className="space-y-6">
      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">Predykcje na zbiorze testowym (pełny)</h3>

        <div className="mb-4">
          <div className="inline-block bg-white/5 border border-white/10 rounded-xl p-3 text-xs backdrop-blur-sm">
            <div className="mb-1">{last?.date ?? "—"}</div>
            <div className="text-gray-400">— True (jutro): {last ? fmt4(last.true) : "—"}</div>
            <div className="text-gray-400">— Baseline: {last ? fmt4(last.baseline) : "—"}</div>
            <div className="text-gray-400">— Ridge: {last ? fmt4(last.ridge) : "—"}</div>
            <div className="text-gray-400">— Random Forest: {last ? fmt4(last.rf) : "—"}</div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={pred}>
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
              domain={yDomainFull}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="true" stroke="#3b82f6" strokeWidth={2} dot={false} name="Rzeczywiste (jutro)" />
            <Line type="monotone" dataKey="baseline" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Baseline" />
            <Line type="monotone" dataKey="ridge" stroke="#ec4899" strokeWidth={2} dot={false} name="Ridge" />
            <Line type="monotone" dataKey="rf" stroke="#14b8a6" strokeWidth={1.6} dot={false} strokeDasharray="3 3" name="Random Forest" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">Predykcje — zoom ostatnie 90 dni</h3>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={zoom90}>
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
              domain={yDomainZoom}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="true" stroke="#3b82f6" strokeWidth={2} dot={false} name="Rzeczywiste (jutro)" />
            <Line type="monotone" dataKey="baseline" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Baseline" />
            <Line type="monotone" dataKey="ridge" stroke="#eab308" strokeWidth={2} dot={false} name="Ridge" />
            <Line type="monotone" dataKey="rf" stroke="#22c55e" strokeWidth={2} dot={false} name="Random Forest" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
