// src/components/DashboardTab.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
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
  ReferenceLine,
} from "recharts";
import { api, ResultsResponse } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

type MetricPack = { MAE: number; RMSE: number; MAPE_pct: number };

type RunParams = {
  years: number;
  refresh: boolean;
  noTuning: boolean;
  testSizeSamples: number;
  zoomWindowDays: number;
  forecastDays7: number;
  forecastDays1m: number;
  forecastDays12m: number;
};

type LogResponseLike = {
  text?: string;
  nextOffset?: number;
  state?: {
    running?: boolean;
    stage?: "fetch" | "train" | null;
    error?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  };
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeMetricPack(v: any): MetricPack | null {
  if (!v || typeof v !== "object") return null;

  const root = v?.test ?? v?.val ?? v;

  const mae = toNum(root?.MAE ?? root?.mae);
  const rmse = toNum(root?.RMSE ?? root?.rmse);
  const mape = toNum(root?.MAPE_pct ?? root?.mape_pct ?? root?.MAPE ?? root?.mape);

  if (mae === null || rmse === null || mape === null) return null;
  return { MAE: mae, RMSE: rmse, MAPE_pct: mape };
}

function prettyModelName(key: string) {
  const k = String(key).toLowerCase();

  if (k.includes("baseline")) return "Baseline";
  if (k.includes("ma5")) return "MA(5)";
  if (k.includes("momentum")) return "Momentum";
  if (k.includes("ridge")) return "Ridge";
  if (k.includes("rf") || k.includes("random_forest") || k.includes("randomforest")) return "RandomForest";
  if (k.includes("extra")) return "ExtraTrees";
  if (k.includes("hgb") || k.includes("hist_gb")) return "HistGB";

  return key;
}

function pickPrimaryHorizon(metrics: any): { h: number | null; node: any } {
  const byH = metrics?.by_horizon ?? metrics?.byHorizon;
  if (byH && typeof byH === "object") {
    const keys = Object.keys(byH);
    if (keys.length) {
      const nums = keys
        .map((k) => ({ k, n: Number(k) }))
        .filter((x) => Number.isFinite(x.n))
        .sort((a, b) => a.n - b.n);

      const preferred = nums.find((x) => x.n === 7) ?? nums[0];
      if (preferred) return { h: preferred.n, node: byH[preferred.k] };
    }
  }

  const testByH = metrics?.test?.by_horizon ?? metrics?.test?.byHorizon;
  if (testByH && typeof testByH === "object") {
    const keys = Object.keys(testByH);
    const nums = keys
      .map((k) => ({ k, n: Number(k) }))
      .filter((x) => Number.isFinite(x.n))
      .sort((a, b) => a.n - b.n);

    const preferred = nums.find((x) => x.n === 7) ?? nums[0];
    if (preferred) return { h: preferred.n, node: testByH[preferred.k] };
  }

  return { h: null, node: metrics };
}

function extractModelPacks(metrics: any): Array<{ key: string; pack: MetricPack }> {
  if (!metrics || typeof metrics !== "object") return [];

  const { node } = pickPrimaryHorizon(metrics);
  const out: Array<{ key: string; pack: MetricPack }> = [];

  const candidateRoots: any[] = [node, node?.models, node?.model_metrics, node?.metrics].filter(Boolean);

  for (const root of candidateRoots) {
    if (!root || typeof root !== "object") continue;

    for (const [k, v] of Object.entries(root)) {
      const pack = normalizeMetricPack(v);
      if (pack) out.push({ key: String(k), pack });
    }
  }

  if (!out.length) {
    for (const [k, v] of Object.entries(metrics)) {
      const pack = normalizeMetricPack(v);
      if (pack) out.push({ key: String(k), pack });
    }
  }

  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
}

function fmt4(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(4).replace(".", ",");
}

function fmt2(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(2).replace(".", ",");
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;

  const d = payload[0]?.payload?.date ?? "";

  return (
    <div className="rounded-2xl border border-white/10 bg-[#070b16] p-3 text-xs text-white shadow-xl">
      <div className="mb-2">{d}</div>
      {payload.map((entry: any, index: number) => (
        <div key={index} style={{ color: entry.color }}>
          {entry.name}: {entry.value === null || entry.value === undefined ? "—" : fmt4(entry.value)}
        </div>
      ))}
    </div>
  );
};

export default function DashboardTab() {
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [series, setSeries] = useState<Array<{ date: string; value: number }>>([]);
  const [logs, setLogs] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [runErr, setRunErr] = useState<string>("");
  const [backendErr, setBackendErr] = useState<string>("");
  const [runStage, setRunStage] = useState<string>("");

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

  const loadDashboard = useCallback(async () => {
    try {
      const [r, s, lg] = await Promise.all([
        api.results(),
        api.series(3650),
        api.logs().catch(() => ({ text: "", nextOffset: 0, state: { running: false, stage: null } })),
      ]);

      setBackendErr("");
      setResults(r);
      setSeries(s.series ?? []);
      setLogs(lg.text ?? "");
      setRunStage(lg.state?.stage ? String(lg.state.stage) : "");
    } catch (e: any) {
      setBackendErr(String(e?.message ?? e));
      setResults(null);
      setSeries([]);
      setLogs("");
      setRunStage("");
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!isRunning) return;

    const id = window.setInterval(async () => {
      try {
        const lg: LogResponseLike = await api.logs();
        setLogs(lg.text ?? "");
        setRunStage(lg.state?.stage ? String(lg.state.stage) : "");
      } catch {
        // ignore polling errors
      }
    }, 1200);

    return () => window.clearInterval(id);
  }, [isRunning]);

  const bestPack = useMemo(() => {
    const m = (results as any)?.metrics;
    const packs = extractModelPacks(m);

    if (!packs.length) return null;

    const bestBy = (field: keyof MetricPack) =>
      packs.reduce((acc, cur) => (cur.pack[field] < acc.pack[field] ? cur : acc), packs[0]);

    const bestMae = bestBy("MAE");
    const bestRmse = bestBy("RMSE");
    const bestMape = bestBy("MAPE_pct");

    return {
      bestModel: prettyModelName(bestMae.key),
      MAE: bestMae.pack.MAE,
      RMSE: bestRmse.pack.RMSE,
      MAPE_pct: bestMape.pack.MAPE_pct,
      horizon: pickPrimaryHorizon(m).h,
    };
  }, [results]);

  const lastRate = useMemo(() => {
    if (series?.length) return series[series.length - 1];
    const lr = results?.lastRate;
    return lr ? { date: lr.date, value: lr.value } : null;
  }, [series, results]);

  const lastValue = lastRate?.value ?? null;

  const dailyPct = useMemo(() => {
    if (series && series.length >= 2) {
      const today = series[series.length - 1]?.value;
      const yesterday = series[series.length - 2]?.value;
      if (today !== undefined && yesterday !== undefined && yesterday !== 0) {
        return ((today - yesterday) / yesterday) * 100;
      }
    }

    const v = (results as any)?.lastRate?.deltaPct;
    return toNum(v);
  }, [series, results]);

  const dailyAbs = useMemo(() => {
    if (series && series.length >= 2) {
      const today = series[series.length - 1]?.value;
      const yesterday = series[series.length - 2]?.value;
      if (today !== undefined && yesterday !== undefined) {
        return today - yesterday;
      }
    }

    const v = (results as any)?.lastRate?.delta;
    return toNum(v);
  }, [series, results]);

  const yDomainSeries = useMemo(() => yDomainFromData(series, ["value"], 0.08, 0.02), [series]);

  async function handleRun() {
    setIsRunning(true);
    setRunErr("");
    setRunStage("fetch");

    try {
      await api.run({
        years: params.years,
        refresh: params.refresh,
        noTuning: params.noTuning,
        testSizeSamples: params.testSizeSamples,
        zoomWindowDays: params.zoomWindowDays,
        forecastDays7: params.forecastDays7,
        forecastDays1m: params.forecastDays1m,
        forecastDays12m: params.forecastDays12m,
      });

      await loadDashboard();
      setRunStage("");
    } catch (e: any) {
      setRunErr(String(e?.message ?? e));

      try {
        const lg: LogResponseLike = await api.logs();
        setLogs(lg.text ?? "");
        setRunStage(lg.state?.stage ? String(lg.state.stage) : "");
      } catch {
        // ignore
      }
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="app-page space-y-6">
      {backendErr ? (
        <Card className="app-card border-red-500/30 bg-red-500/10 p-4 rounded-3xl">
          <div className="text-red-100 text-sm font-medium">Backend nie odpowiada na 127.0.0.1:8000.</div>
          <div className="mt-1 text-red-200/80 text-xs">Uruchom FastAPI w drugim terminalu, potem odśwież stronę. Szczegóły: {backendErr}</div>
        </Card>
      ) : null}

      {runErr ? (
        <Card className="app-card border-red-500/30 bg-red-500/10 p-4 rounded-3xl">
          <div className="text-red-200 text-sm">Błąd: {runErr}</div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="app-card p-6 rounded-3xl">
          <div className="text-xs text-gray-400 uppercase tracking-wider">Ostatni kurs</div>
          <div className="mt-3 text-3xl font-semibold text-white">{lastValue === null ? "—" : fmt4(lastValue)} zł</div>
          <div className="mt-2 text-xs text-gray-500">{lastRate?.date ?? "—"}</div>
        </Card>

        <Card className="app-card border-red-500/20 p-6 rounded-3xl">
          <div className="text-xs text-gray-400 uppercase tracking-wider">Zmiana dzienna</div>
          <div
            className={`mt-3 text-3xl font-semibold ${
              dailyPct !== null && dailyPct < 0 ? "text-red-300" : "text-green-300"
            }`}
          >
            {dailyPct === null ? "—" : `${fmt2(dailyPct)}%`}
          </div>
          <div className="mt-2 text-xs text-gray-500">{dailyAbs === null ? "—" : `${fmt4(dailyAbs)} zł`}</div>
        </Card>

        <Card className="app-card border-purple-500/20 p-6 rounded-3xl">
          <div className="text-xs text-gray-400 uppercase tracking-wider">
            RMSE (BEST) {bestPack?.horizon ? <span className="text-gray-500">• H={bestPack.horizon}</span> : null}
          </div>
          <div className="mt-3 text-3xl font-semibold text-white">{bestPack ? fmt4(bestPack.RMSE) : "—"}</div>
        </Card>

        <Card className="app-card border-cyan-500/20 p-6 rounded-3xl">
          <div className="text-xs text-gray-400 uppercase tracking-wider">
            MAE (BEST) {bestPack?.horizon ? <span className="text-gray-500">• H={bestPack.horizon}</span> : null}
          </div>
          <div className="mt-3 text-3xl font-semibold text-white">{bestPack ? fmt4(bestPack.MAE) : "—"}</div>
          <div className="mt-2 text-xs text-gray-500">Best model: {bestPack?.bestModel ?? "—"}</div>
        </Card>

        <Card className="app-card border-emerald-500/20 p-6 rounded-3xl">
          <div className="text-xs text-gray-400 uppercase tracking-wider">
            MAPE (BEST) {bestPack?.horizon ? <span className="text-gray-500">• H={bestPack.horizon}</span> : null}
          </div>
          <div className="mt-3 text-3xl font-semibold text-white">
            {bestPack ? `${fmt2(bestPack.MAPE_pct)}%` : "—"}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,0.8fr)] items-start">
        <Card className="app-card p-6 rounded-3xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white/90">EUR/PLN (historia)</h3>
          </div>

          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={series}>
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
                domain={yDomainSeries}
                width={78}
                tickFormatter={(v) => fmt4(Number(v))}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2.2} dot={false} name="EUR/PLN" />
              {lastRate?.date ? <ReferenceLine x={lastRate.date} stroke="rgba(59,130,246,0.35)" /> : null}
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <div className="space-y-6">
          <Card className="app-card p-6 rounded-3xl">
            <div className="text-white/90 mb-4">Uruchom eksperyment</div>

            <div className="text-xs text-gray-400 mb-2">Lata:</div>
            <input
              className="app-input w-full px-3 py-2 text-white"
              type="number"
              value={params.years}
              onChange={(e) => setParams((p) => ({ ...p, years: Number(e.target.value) }))}
              min={1}
              max={30}
            />

            <div className="mt-4 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={params.refresh}
                  onChange={(e) => setParams((p) => ({ ...p, refresh: e.target.checked }))}
                />
                Odśwież
              </label>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={params.noTuning}
                  onChange={(e) => setParams((p) => ({ ...p, noTuning: e.target.checked }))}
                />
                Bez tuningu
              </label>
            </div>

            <Button
              className="app-button mt-5 w-full py-6"
              onClick={handleRun}
              disabled={isRunning}
            >
              {isRunning ? `Running${runStage ? ` (${runStage})` : "..."}` : "Run"}
            </Button>
          </Card>

          <Card className="app-card p-6 rounded-3xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-white/90">Logi</div>
              <Button
                variant="secondary"
                className="rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white"
                onClick={() => navigator.clipboard.writeText(logs ?? "")}
              >
                Copy
              </Button>
            </div>

            <pre className="text-xs text-gray-300 whitespace-pre-wrap max-h-[300px] overflow-auto">
              {logs || "—"}
            </pre>
          </Card>
        </div>
      </div>
    </div>
  );
}