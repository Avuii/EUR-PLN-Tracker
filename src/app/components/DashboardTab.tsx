import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, type RunParams, type ResultsPayload, type SeriesPoint } from "./api";
import { yDomainFromData } from "./chartDomain";

type MetricPack = {
  rmse?: unknown;
  mae?: unknown;
  mape?: unknown;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  // tolerujemy stringi typu "0.1789" albo "0.1789%"
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

function pickMetricPack(metrics: any): MetricPack | null {
  if (!metrics) return null;
  return metrics?.best ?? metrics?.rf ?? metrics?.ridge ?? metrics?.baseline ?? metrics;
}

export function DashboardTab() {
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
  const [logs, setLogs] = useState<string>("");

  const reload = async () => {
    const r = await api.results();
    const s = await api.series(1830);
    setResults(r);
    setSeries(s.series);
  };

  useEffect(() => {
    reload().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = results?.lastRate;
  const metrics = results?.metrics;

  const bestPack = useMemo(() => {
    const m = metrics as any;
    const packs: Array<{ name: string; pack: MetricPack }> = [
      { name: "Baseline", pack: m?.baseline ?? {} },
      { name: "Ridge", pack: m?.ridge ?? {} },
      { name: "Random Forest", pack: m?.rf ?? {} },
      { name: m?.best?.name ?? "Best", pack: m?.best ?? {} },
    ].filter((x) => x.pack && (x.pack.rmse !== undefined || x.pack.mae !== undefined));

    let best = packs[0] ?? null;
    let bestMae = toNum(best?.pack?.mae) ?? Number.POSITIVE_INFINITY;

    for (const p of packs) {
      const mae = toNum(p.pack.mae);
      const score = mae ?? Number.POSITIVE_INFINITY;
      if (score < bestMae) {
        bestMae = score;
        best = p;
      }
    }
    return best;
  }, [metrics]);

  const bestName = bestPack?.name ?? "—";
  const bestRMSE = toNum(bestPack?.pack?.rmse);
  const bestMAE = toNum(bestPack?.pack?.mae);
  const bestMAPE = toNum(bestPack?.pack?.mape);

  const mainPack = pickMetricPack(metrics as any);
  const rmse = toNum((mainPack as any)?.rmse);
  const mae = toNum((mainPack as any)?.mae);
  const mape = toNum((mainPack as any)?.mape);

  const historicalData = useMemo(
    () =>
      (series ?? []).map((p) => ({
        date: p.date,
        rate: p.value,
      })),
    [series]
  );

  const yDomain = useMemo(
    () => yDomainFromData(historicalData, ["rate"], 0.06, 0.02),
    [historicalData]
  );

  const run = async () => {
    setErr(null);
    setBusy(true);
    setLogs("");

    try {
      const res = await api.run(params);
      setLogs(res.logs ?? "");
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

      {/* ===== TOP CARDS ===== */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">OSTATNI KURS</div>
          <div className="flex items-end gap-2">
            <div className="text-4xl font-semibold tabular-nums tracking-tight">
              {fmtRatePLN(last?.value ?? null)}
            </div>
            <div className="text-gray-400 mb-1">zł</div>
          </div>
          <div className="text-xs text-gray-500 mt-3">{last?.date ?? "—"}</div>
        </Card>

        <Card className="bg-gradient-to-br from-red-500/10 to-red-500/[0.03] border-red-500/20 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-xs text-gray-400 mb-2 tracking-wider">ZMIANA DZIENNA</div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight text-red-300">
            {last?.dailyChangePct !== undefined && last?.dailyChangePct !== null
              ? `${last.dailyChangePct.toFixed(2).replace(".", ",")}%`
              : "—"}
          </div>
          <div className="text-xs text-red-200/70 mt-2 tabular-nums">
            {last?.dailyChange !== undefined && last?.dailyChange !== null
              ? `/ ${last.dailyChange.toFixed(4).replace(".", ",")} zł`
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

      {/* ===== MAIN GRID ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CHART */}
        <Card className="lg:col-span-2 bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold">EUR/PLN</div>
            <Button variant="secondary" className="rounded-full" onClick={() => reload().catch((e) => setErr(String(e)))}>
              Reload
            </Button>
          </div>

          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
                <YAxis domain={yDomain} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} />
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

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* RUN */}
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

          {/* BEST MODEL */}
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

          {/* LOGS */}
          <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Logs</div>
              <div className="flex gap-2">
                <Button variant="secondary" className="rounded-full" onClick={() => navigator.clipboard.writeText(logs)}>
                  Copy
                </Button>
                <Button variant="secondary" className="rounded-full" onClick={() => setLogs("")}>
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
    </div>
  );
}
