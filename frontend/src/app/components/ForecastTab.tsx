// src/components/ForecastTab.tsx
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, ForecastRow } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

type ModelKeyOption = { key: string; label: string };

function isNumberLike(v: any) {
  return typeof v === "number" && Number.isFinite(v);
}

function formatNum(v: any) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(".", ",");
}

function prettyModelLabel(key: string) {
  const map: Record<string, string> = {
    baseline: "Baseline",
    ridge: "Ridge",
    rf: "RandomForest",
    extra: "ExtraTrees",
    hgb: "HistGB",
    et: "ExtraTrees (et)",
    best_value: "Best model",
    p80_low: "p80_low",
    p80_high: "p80_high",
    p95_low: "p95_low",
    p95_high: "p95_high",
  };

  return map[key] ?? key;
}

export default function ForecastTab() {
  const horizonOptions = [7, 30, 90, 180, 365];

  const [horizon, setHorizon] = useState<number>(30);
  const [mode, setMode] = useState<"direct" | "iterative">("direct");
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [modelKey, setModelKey] = useState<string>("rf");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const r = await api.forecast(horizon);
        if (!alive) return;

        setRows(r);

        const keys = Object.keys(r?.[0] ?? {});
        const preferred = ["best_value", "rf", "ridge", "baseline", "extra", "hgb", "et"];
        const found = preferred.find((k) => keys.includes(k));
        if (found) setModelKey(found);
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
  }, [horizon]);

  const modelOptions: ModelKeyOption[] = useMemo(() => {
    if (!rows.length) return [];

    const sample = rows[0];
    const keys = Object.keys(sample);

    const blacklist = new Set(["date", "best_model"]);
    const numericKeys = keys.filter((k) => !blacklist.has(k) && rows.some((r) => isNumberLike(r[k])));

    const ordered = [
      "best_value",
      "rf",
      "ridge",
      "baseline",
      "extra",
      "hgb",
      "et",
      ...numericKeys.filter((k) => !["best_value", "rf", "ridge", "baseline", "extra", "hgb", "et"].includes(k)),
    ].filter((k, i, a) => numericKeys.includes(k) && a.indexOf(k) === i);

    return ordered.map((k) => ({ key: k, label: prettyModelLabel(k) }));
  }, [rows]);

  const selectedModelLabel = useMemo(() => prettyModelLabel(modelKey), [modelKey]);

  const chartData = useMemo(() => {
    return rows.map((r) => ({
      ...r,
      date: String(r.date),
      baseline: r.baseline ?? null,
      selected: r[modelKey] ?? null,
      p80_low: r.p80_low ?? null,
      p80_high: r.p80_high ?? null,
      p95_low: r.p95_low ?? null,
      p95_high: r.p95_high ?? null,
    }));
  }, [rows, modelKey]);

  const yDomain = useMemo(() => {
    return yDomainFromData(chartData, ["baseline", "selected", "p95_low", "p95_high"], 0.08, 0.01);
  }, [chartData]);

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 rounded-2xl backdrop-blur-xl shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-xl">Prognozy</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-sm mb-1 text-gray-300">Horyzont (dni robocze)</div>
              <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue placeholder="Wybierz horyzont" />
                </SelectTrigger>
                <SelectContent className="bg-[#0b0f19] border-white/10 text-white">
                  {horizonOptions.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h} dni
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm mb-1 text-gray-300">Model</div>
              <Select value={modelKey} onValueChange={setModelKey}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue placeholder="Wybierz model" />
                </SelectTrigger>
                <SelectContent className="bg-[#0b0f19] border-white/10 text-white">
                  {modelOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-sm mb-1 text-gray-300">Tryb prognozy</div>
              <Select value={mode} onValueChange={(v) => setMode(v as "direct" | "iterative")}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0b0f19] border-white/10 text-white">
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="iterative">Iterative</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <div className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-gray-300">
                Im dalej w przyszłość, tym większa niepewność prognozy.
              </div>
            </div>
          </div>

          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-200">
              Błąd: {err}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Horyzont</div>
              <div className="mt-2 text-white text-xl font-semibold">{horizon} dni</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Model</div>
              <div className="mt-2 text-white text-xl font-semibold">{selectedModelLabel}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Tryb</div>
              <div className="mt-2 text-white text-xl font-semibold capitalize">{mode}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Punktów prognozy</div>
              <div className="mt-2 text-white text-xl font-semibold">{rows.length}</div>
            </div>
          </div>

          <div className="h-[420px] w-full rounded-2xl border border-white/10 bg-black/20 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 18, right: 18, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis domain={yDomain} tick={{ fontSize: 12, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    color: "#fff",
                  }}
                  formatter={(val: any, name: any) => [formatNum(val), String(name)]}
                  labelFormatter={(l) => `Data: ${l}`}
                />
                <Legend wrapperStyle={{ color: "#e5e7eb" }} />

                <Area type="monotone" dataKey="p95_high" stroke="none" fillOpacity={0} />
                <Area type="monotone" dataKey="p95_low" stroke="none" fillOpacity={0} />
                <Area
                  type="monotone"
                  dataKey="p95_high"
                  stroke="none"
                  fillOpacity={0.08}
                  fill="#94a3b8"
                  name="CI 95%"
                />

                <Area type="monotone" dataKey="p80_high" stroke="none" fillOpacity={0} />
                <Area type="monotone" dataKey="p80_low" stroke="none" fillOpacity={0} />
                <Area
                  type="monotone"
                  dataKey="p80_high"
                  stroke="none"
                  fillOpacity={0.12}
                  fill="#cbd5e1"
                  name="CI 80%"
                />

                <Line type="monotone" dataKey="baseline" dot={false} strokeWidth={2} stroke="#94a3b8" name="Baseline" />
                <Line type="monotone" dataKey="selected" dot={false} strokeWidth={2.4} stroke="#22d3ee" name={selectedModelLabel} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/20">
            <div className="px-4 py-3 text-sm font-medium border-b border-white/10 bg-black/30 text-white">
              Tabela prognozy ({horizon} dni)
            </div>

            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-black/60 backdrop-blur-xl">
                  <tr className="text-left">
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">Data</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">Baseline</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">{selectedModelLabel}</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">p80</th>
                    <th className="px-3 py-2 border-b border-white/10 text-gray-300">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={5}>
                        Ładowanie…
                      </td>
                    </tr>
                  )}

                  {!loading && !rows.length && !err && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={5}>
                        Brak danych prognozy.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    rows.map((r, idx) => (
                      <tr key={idx} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2 text-white font-mono">{String(r.date)}</td>
                        <td className="px-3 py-2 text-white font-mono">{formatNum(r.baseline)}</td>
                        <td className="px-3 py-2 text-white font-mono">{formatNum(r[modelKey])}</td>
                        <td className="px-3 py-2 text-gray-300 font-mono">
                          {r.p80_low == null || r.p80_high == null
                            ? "—"
                            : `${formatNum(r.p80_low)} – ${formatNum(r.p80_high)}`}
                        </td>
                        <td className="px-3 py-2 text-gray-300 font-mono">
                          {r.p95_low == null || r.p95_high == null
                            ? "—"
                            : `${formatNum(r.p95_low)} – ${formatNum(r.p95_high)}`}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {mode === "iterative" && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-3 text-sm text-yellow-100">
              Tryb iterative: jeśli backend nie generuje osobnych forecastów iterative, UI pokaże dane z ostatniego runa.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}