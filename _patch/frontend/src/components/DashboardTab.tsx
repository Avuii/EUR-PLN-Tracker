// src/app/components/DashboardTab.tsx
import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api, type RunParams, type ResultsPayload, type SeriesPoint, type ForecastPoint, type PredictionTestRow } from "../lib/api";
import { yDomainFromData, yDomainSymmetricAroundZero } from "../lib/chartDomain";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace("%", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmt5(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(5).replace(".", ",");
}

function fmtPct(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x.toFixed(2).replace(".", ",")}%`;
}

function fmtRatePLN(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(4).replace(".", ",");
}

function getMetric(pack: any, key: string): unknown {
  if (!pack) return undefined;
  const keys = [key, key.toUpperCase(), key.toLowerCase()];
  for (const k of keys) {
    if (pack?.[k] !== undefined) return pack[k];
  }
  return undefined;
}

function extractMetricPacks(metrics: any): Array<{ name: string; pack: any }> {
  if (!metrics) return [];

  // Nowy format (z train_eval.py): baseline_persistence, ridge_delta, random_forest_delta, ...
  const candidates = [
    { name: "Random Forest", key: "random_forest_delta" },
    { name: "Ridge", key: "ridge_delta" },
    { name: "Baseline (persistence)", key: "baseline_persistence" },
    { name: "Baseline (MA5)", key: "baseline_ma5" },
    { name: "Baseline (momentum)", key: "baseline_momentum" },
  ];

  const out: Array<{ name: string; pack: any }> = [];
  for (const c of candidates) {
    const p = metrics?.[c.key];
    if (p && (getMetric(p, "RMSE") !== undefined || getMetric(p, "MAE") !== undefined)) {
      out.push({ name: c.name, pack: p });
    }
  }

  // Stary/alternatywny format: {best, rf, ridge, baseline}
  if (out.length === 0) {
    const legacy = [
      { name: "Baseline", pack: metrics?.baseline },
      { name: "Ridge", pack: metrics?.ridge },
      { name: "Random Forest", pack: metrics?.rf },
      { name: String(metrics?.best?.name ?? "Best"), pack: metrics?.best },
    ];
    for (const x of legacy) {
      if (x.pack && (getMetric(x.pack, "rmse") !== undefined || getMetric(x.pack, "RMSE") !== undefined)) {
        out.push(x);
      }
    }
  }

  return out;
}

export default function DashboardTab() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [params, setParams] = useState<RunParams>({
    years: 5,
    refresh: false,
    noTuning: true,
    testSizeSamples: 260,
    zoomWindowDays: 90,
    forecastDays7: 7,
    forecastDays1m: 22,
    forecastDays12m: 260,
  });

  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [forecast7, setForecast7] = useState<ForecastPoint[]>([]);
  const [predRows, setPredRows] = useState<PredictionTestRow[]>([]);
  const [logs, setLogs] = useState<string>("");

  const reload = async () => {
    const [r, s, p] = await Promise.all([
      api.results(),
      api.series(params.years * 365 + 30),
      api.predictionsTest(params.testSizeSamples),
    ]);
    setResults(r);
    setSeries(s.series ?? []);
    setForecast7(r.forecast7 ?? []);
    setPredRows(p.rows ?? []);
  };

  useEffect(() => {
    reload().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = results?.lastRate ?? null;
  const metrics = results?.metrics;

  const metricPacks = useMemo(() => extractMetricPacks(metrics as any), [metrics]);

  // best model wg RMSE (fallback: MAE)
  const bestPack = useMemo(() => {
    if (!metricPacks.length) return null;
    let best = metricPacks[0];
    let bestScore =
      toNum(getMetric(best.pack, "RMSE") ?? getMetric(best.pack, "rmse")) ??
      toNum(getMetric(best.pack, "MAE") ?? getMetric(best.pack, "mae")) ??
      Number.POSITIVE_INFINITY;

    for (const p of metricPacks) {
      const rm = toNum(getMetric(p.pack, "RMSE") ?? getMetric(p.pack, "rmse"));
      const ma = toNum(getMetric(p.pack, "MAE") ?? getMetric(p.pack, "mae"));
      const score = rm ?? ma ?? Number.POSITIVE_INFINITY;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }, [metricPacks]);

  const bestName = bestPack?.name ?? "—";
  const bestRMSE = toNum(getMetric(bestPack?.pack, "RMSE") ?? getMetric(bestPack?.pack, "rmse"));
  const bestMAE = toNum(getMetric(bestPack?.pack, "MAE") ?? getMetric(bestPack?.pack, "mae"));
  const bestMAPE = toNum(
    getMetric(bestPack?.pack, "MAPE_pct") ?? getMetric(bestPack?.pack, "MAPE") ?? getMetric(bestPack?.pack, "mape")
  );

  // metryki top (pokazujemy "best")
  const rmse = bestRMSE;
  const mae = bestMAE;
  const mape = bestMAPE;

  // wykres historii
  const historicalData = useMemo(
    () => (series ?? []).map((p) => ({ date: p.date, rate: p.value })),
    [series]
  );

  const yDomainHistory = useMemo(
    () => yDomainFromData(historicalData, ["rate"], 0.06, 0.02),
    [historicalData]
  );

  // pred test (z CSV)
  const predTestData = useMemo(
    () =>
      (predRows ?? []).map((p) => ({
        date: p.date,
        true_tomorrow: p.true,
        baseline: p.baseline,
        ridge: p.ridge,
        rf: p.rf,
      })),
    [predRows]
  );

  const yDomainPred = useMemo(
    () => yDomainFromData(predTestData, ["true_tomorrow", "baseline", "ridge", "rf"], 0.06, 0.02),
    [predTestData]
  );

  // błędy (symetrycznie wokół 0)
  const errTestData = useMemo(
    () =>
      (predRows ?? []).map((p) => ({
        date: p.date,
        baseline: p.errBaseline,
        ridge: p.errRidge,
        rf: p.errRf,
      })),
    [predRows]
  );

  const yDomainErr = useMemo(
    () => yDomainSymmetricAroundZero(errTestData, ["baseline", "ridge", "rf"], 0.15, 0.0005),
    [errTestData]
  );

  const run = async () => {
    setErr(null);
    setBusy(true);
    setLogs("");

    try {
      const res = await api.run(params);
      if (res?.logs) setLogs(res.logs);
      else setLogs((await api.logs()).logs);

      await reload();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {err ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          Błąd: {err}
        </div>
      ) : null}

      {/* TOP CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">OSTATNI KURS</div>
          <div className="flex items-end gap-2">
            <div className="text-4xl font-semibold tabular-nums tracking-tight">{fmtRatePLN(last?.value ?? null)}</div>
            <div className="text-gray-400 mb-1">zł</div>
          </div>
          <div className="text-xs text-gray-500 mt-3">{last?.date ?? "—"}</div>
        </Card>

        <Card className="bg-gradient-to-br from-red-500/10 to-red-500/[0.03] border-red-500/20 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">ZMIANA DZIENNA</div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight text-red-300">
            {last?.dailyChangePct !== undefined && last?.dailyChangePct !== null
              ? `${Number(last.dailyChangePct).toFixed(2).replace(".", ",")}%`
              : "—"}
          </div>
          <div className="text-xs text-red-200/70 mt-2 tabular-nums">
            {last?.dailyChange !== undefined && last?.dailyChange !== null
              ? `/ ${Number(last.dailyChange).toFixed(4).replace(".", ",")} zł`
              : "—"}
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/[0.03] border-purple-500/20 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">RMSE (BEST)</div>
          <div className="text-3xl text-purple-400 tabular-nums tracking-tight" title={rmse === null ? "" : String(rmse)}>
            {fmt5(rmse)}
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/[0.03] border-cyan-500/20 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">MAE (BEST)</div>
          <div className="text-3xl text-cyan-400 tabular-nums tracking-tight" title={mae === null ? "" : String(mae)}>
            {fmt5(mae)}
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-green-500/[0.03] border-green-500/20 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">MAPE (BEST)</div>
          <div className="text-3xl text-green-400 tabular-nums tracking-tight" title={mape === null ? "" : String(mape)}>
            {fmtPct(mape)}
          </div>
        </Card>
      </div>

      {/* HISTORY + RUN + FORECAST7 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold">EUR/PLN</div>
            <Button className="rounded-full" onClick={() => reload().catch((e) => setErr(String(e)))}>
              Odśwież dane
            </Button>
          </div>

          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
                <YAxis domain={yDomainHistory} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(18, 22, 40, 0.95)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 16,
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.8)" }}
                  formatter={(v: any) => [fmtRatePLN(Number(v)), "EUR/PLN"]}
                />
                <Line type="monotone" dataKey="rate" stroke="rgb(251, 146, 60)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
            <div className="text-lg font-semibold mb-4">Parametry uruchomienia</div>

            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Lata:</span>
                <input
                  type="number"
                  className="w-20 rounded-full bg-white/5 border border-white/10 px-3 py-2 text-right"
                  value={params.years}
                  min={1}
                  max={30}
                  onChange={(e) => setParams((p) => ({ ...p, years: Number(e.target.value) }))}
                />
              </div>

              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={params.refresh} onChange={(e) => setParams((p) => ({ ...p, refresh: e.target.checked }))} />
                Odśwież
              </label>

              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={params.noTuning} onChange={(e) => setParams((p) => ({ ...p, noTuning: e.target.checked }))} />
                Bez tuningu
              </label>

              <Button className="w-full rounded-full" onClick={run} disabled={busy}>
                {busy ? "Running..." : "Run"}
              </Button>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
            <div className="text-lg font-semibold mb-3">Prognoza na 7 dni roboczych</div>

            {forecast7.length === 0 ? (
              <div className="text-sm text-gray-400">
                Brak danych prognozy. Kliknij <span className="text-white">Run</span>.
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {forecast7.map((r) => (
                  <div key={r.date} className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                    <div className="text-gray-300">{r.date}</div>
                    <div className="flex gap-3 tabular-nums">
                      <span className="text-gray-300">B: {fmtRatePLN(r.baseline)}</span>
                      <span className="text-cyan-300">R: {fmtRatePLN(r.ridge)}</span>
                      <span className="text-green-300">RF: {fmtRatePLN(r.rf)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* PRED TEST + RIGHT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-lg font-semibold mb-4">Predykcje na zbiorze testowym (pełny)</div>

          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={predTestData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
                <YAxis domain={yDomainPred} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(18, 22, 40, 0.95)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 16,
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.8)" }}
                  formatter={(v: any, name: any) => [fmtRatePLN(Number(v)), name]}
                />
                <Line type="monotone" dataKey="true_tomorrow" stroke="rgb(59, 130, 246)" strokeWidth={2} dot={false} name="Rzeczywiste (jutro)" />
                <Line type="monotone" dataKey="baseline" stroke="rgb(168, 85, 247)" strokeWidth={2} dot={false} name="Baseline" />
                <Line type="monotone" dataKey="ridge" stroke="rgb(244, 63, 94)" strokeWidth={2} dot={false} name="Ridge" />
                <Line type="monotone" dataKey="rf" stroke="rgb(45, 212, 191)" strokeWidth={2} dot={false} name="Random Forest" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">Test</h3>

            <div className="text-center mb-3">
              <div className="text-sm text-gray-400 mb-1">Najlepszy model (MAE):</div>
              <div className="text-cyan-400 text-lg font-semibold">{bestName}</div>
            </div>

            <div className="text-sm text-gray-400 space-y-2">
              <div className="flex items-center justify-between">
                <span>RMSE</span>
                <span className="text-purple-400 tabular-nums" title={bestRMSE === null ? "" : String(bestRMSE)}>
                  {fmt5(bestRMSE)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>MAE</span>
                <span className="text-cyan-400 tabular-nums" title={bestMAE === null ? "" : String(bestMAE)}>
                  {fmt5(bestMAE)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>MAPE</span>
                <span className="text-green-400 tabular-nums" title={bestMAPE === null ? "" : String(bestMAPE)}>
                  {fmtPct(bestMAPE)}
                </span>
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Logs</div>
              <div className="flex gap-2">
                <Button className="rounded-full" onClick={() => navigator.clipboard.writeText(logs)}>
                  Copy
                </Button>
                <Button className="rounded-full" onClick={() => setLogs("")}>
                  Clear
                </Button>
              </div>
            </div>

            <pre className="h-[180px] overflow-auto rounded-2xl bg-[#0b1020]/70 border border-white/10 p-4 text-xs text-gray-200 whitespace-pre-wrap">
              {logs ? logs : "Brak logów. Kliknij Run."}
            </pre>
          </Card>
        </div>
      </div>

      {/* ERROR CHART */}
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <div className="text-lg font-semibold mb-4">Wykres błędów (pred - true)</div>

        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={errTestData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
              <YAxis domain={yDomainErr} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: "rgba(18, 22, 40, 0.95)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 16,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.8)" }}
                formatter={(v: any, name: any) => [fmtRatePLN(Number(v)), name]}
              />
              <Line type="monotone" dataKey="baseline" stroke="rgb(168, 85, 247)" strokeWidth={2} dot={false} name="Błąd Baseline" />
              <Line type="monotone" dataKey="ridge" stroke="rgb(244, 63, 94)" strokeWidth={2} dot={false} name="Błąd Ridge" />
              <Line type="monotone" dataKey="rf" stroke="rgb(45, 212, 191)" strokeWidth={2} dot={false} name="Błąd RF" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
