import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { api } from "../lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { yDomainFromData, yDomainSymmetric } from "../lib/chartDomain";

type Row = {
  date: string;
  true: number;
  baseline: number;
  ridge: number;
  rf: number;
  errBaseline: number;
  errRidge: number;
  errRf: number;
};

function fmt4(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(4).replace(".", ",");
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
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
};

export default function ChartsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.predictionsTest(0);
        setRows(r.rows as any);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  const comparisonData = useMemo(() => rows.slice(Math.max(0, rows.length - 160)), [rows]);
  const residualData = useMemo(
    () =>
      rows.slice(Math.max(0, rows.length - 160)).map((r) => ({
        date: r.date,
        baseline: r.errBaseline,
        ridge: r.errRidge,
        rf: r.errRf,
      })),
    [rows]
  );

  const yDomainComparison = useMemo(
    () => yDomainFromData(comparisonData, ["true", "baseline", "ridge", "rf"], 0.06, 0.02),
    [comparisonData]
  );

  const yDomainResidual = useMemo(
    () => yDomainSymmetric(residualData as any, ["baseline", "ridge", "rf"], 0.12, 0.005),
    [residualData]
  );

  return (
    <div className="space-y-6">
      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">Porównanie: wartości rzeczywiste vs predykcje (ostatnie ~160 dni test)</h3>

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
            <YAxis
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              domain={yDomainComparison}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="true" stroke="#f59e0b" strokeWidth={2.2} dot={false} name="True" />
            <Line type="monotone" dataKey="baseline" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Baseline" />
            <Line type="monotone" dataKey="ridge" stroke="#ec4899" strokeWidth={2} dot={false} name="Ridge" />
            <Line type="monotone" dataKey="rf" stroke="#22c55e" strokeWidth={2} dot={false} name="RandomForest" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <h3 className="mb-4">Reszty (pred - true) — ostatnie ~160 dni</h3>

        <ResponsiveContainer width="100%" height={260}>
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
            <YAxis
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              domain={yDomainResidual}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="baseline" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Baseline err" />
            <Line type="monotone" dataKey="ridge" stroke="#ec4899" strokeWidth={2} dot={false} name="Ridge err" />
            <Line type="monotone" dataKey="rf" stroke="#22c55e" strokeWidth={2} dot={false} name="RF err" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
