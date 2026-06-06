import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, ForecastRow } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

const HORIZONS = [1, 7, 30, 90, 180, 365];
const PREFERRED_MODELS = ["best_value", "naive", "sma", "ema", "ridge", "elastic", "rf", "extra", "hgb", "sarimax", "mlp", "xgb", "lgbm"];

function isNumberLike(v: any) {
  return typeof v === "number" && Number.isFinite(v);
}

function formatNum(v: any) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(".", ",");
}

function fmtDate(v: any) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function prettyModelLabel(key: string, lang: Lang = "pl") {
  const map: Record<string, string> = {
    best_value: lang === "pl" ? "Best model" : "Best model",
    baseline: "Baseline",
    naive: "Naive",
    sma: "SMA",
    ema: "EMA",
    ridge: "Ridge",
    elastic: "ElasticNet",
    rf: "RandomForest",
    extra: "ExtraTrees",
    hgb: "HistGB",
    sarimax: "SARIMAX",
    mlp: "MLPRegressor",
    xgb: "XGBoost",
    lgbm: "LightGBM",
  };
  return map[key] ?? key;
}

type Lang = "pl" | "en";

type Props = {
  lang: Lang;
};

const text = {
  pl: {
    title: "Prognozy",
    horizon: "Horyzont",
    model: "Model",
    forecastDate: "Data prognozy",
    forecast: "Prognoza",
    error: "Błąd",
    selectedModel: "Wybrany model",
    latestRate: "Ostatni kurs",
    modelValues: "Wartości modeli dla",
    value: "Wartość",
    loading: "Ładowanie…",
    noForecastData: "Brak danych prognozy. Uruchom pipeline.",
    forecastChange: "Zmiana prognozowana",
    bestModel: "Best model",
  },
  en: {
    title: "Forecasts",
    horizon: "Horizon",
    model: "Model",
    forecastDate: "Forecast date",
    forecast: "Forecast",
    error: "Error",
    selectedModel: "Selected model",
    latestRate: "Latest rate",
    modelValues: "Model values for",
    value: "Value",
    loading: "Loading…",
    noForecastData: "No forecast data. Run the pipeline.",
    forecastChange: "Forecast change",
    bestModel: "Best model",
  },
};

export default function ForecastTab({ lang }: Props) {
  const t = text[lang];
  const [horizon, setHorizon] = useState<number>(30);
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [modelKey, setModelKey] = useState<string>("best_value");
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
        const found = PREFERRED_MODELS.find((k) => keys.includes(k) && r.some((row) => isNumberLike(row[k])));
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

  const bestRow = rows[0] ?? null;

  const modelOptions = useMemo(() => {
    if (!bestRow) return [];
    const blacklist = new Set(["date", "best_model", "forecast_target_date", "latest_observation_date", "latest_value", "H", "p80_low", "p80_high", "p95_low", "p95_high"]);
    const numericKeys = Object.keys(bestRow).filter((k) => !blacklist.has(k) && isNumberLike(bestRow[k]));
    const ordered = [...PREFERRED_MODELS, ...numericKeys.filter((k) => !PREFERRED_MODELS.includes(k))].filter(
      (k, i, arr) => numericKeys.includes(k) && arr.indexOf(k) === i
    );
    return ordered.map((k) => ({ key: k, label: prettyModelLabel(k, lang) }));
  }, [bestRow]);

  useEffect(() => {
    if (modelOptions.length && !modelOptions.some((o) => o.key === modelKey)) {
      setModelKey(modelOptions[0].key);
    }
  }, [modelOptions, modelKey]);

  const chartData = useMemo(() => {
    if (!bestRow) return [];
    return modelOptions
      .filter((m) => m.key !== "best_value")
      .map((m) => ({ model: m.label, value: bestRow[m.key] }));
  }, [bestRow, modelOptions]);

  const yDomain = useMemo(() => yDomainFromData(chartData, ["value"], 0.06, 0.01), [chartData]);
  const selectedLabel = prettyModelLabel(modelKey, lang);
  const selectedValue = bestRow?.[modelKey] ?? null;
  const latestValue = bestRow?.latest_value ?? null;
  const forecastChange = isNumberLike(selectedValue) && isNumberLike(latestValue) ? Number(selectedValue) - Number(latestValue) : null;

  return (
    <div className="app-page space-y-6">
      <Card className="app-card rounded-3xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl text-white">{t.title}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1fr_1fr]">
            <div>
              <div className="mb-1 text-sm text-slate-300">{t.horizon}</div>
              <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
                <SelectTrigger className="app-select-trigger h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#070b16] text-white">
                  {HORIZONS.map((h) => <SelectItem key={h} value={String(h)}>H={h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm text-slate-300">{t.model}</div>
              <Select value={modelKey} onValueChange={setModelKey}>
                <SelectTrigger className="app-select-trigger h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#070b16] text-white">
                  {modelOptions.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="app-kpi p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">{t.forecastDate}</div>
              <div className="mt-2 text-xl font-semibold text-white">{fmtDate(bestRow?.date ?? bestRow?.forecast_target_date)}</div>
            </div>

            <div className="app-kpi p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400">{t.forecast}</div>
              <div className="mt-2 text-xl font-semibold text-white">{formatNum(selectedValue)} zł</div>
            </div>
          </div>

          {err ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {t.error}: {err}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="app-kpi p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">{t.selectedModel}</div>
              <div className="mt-3 text-2xl font-semibold text-white">{selectedLabel}</div>
            </div>
            <div className="app-kpi p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">{t.latestRate}</div>
              <div className="mt-3 text-2xl font-semibold text-white">{formatNum(latestValue)} zł</div>
            </div>
            <div className="app-kpi p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">{t.forecastChange}</div>
              <div className={`mt-3 text-2xl font-semibold ${forecastChange != null && forecastChange < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatNum(forecastChange)} zł</div>
            </div>
            <div className="app-kpi p-5">
              <div className="text-xs uppercase tracking-wider text-slate-400">{t.bestModel}</div>
              <div className="mt-3 text-2xl font-semibold text-white">{String(bestRow?.best_model ?? "—")}</div>
            </div>
          </div>

          <div className="app-panel h-[380px] w-full p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 18, left: 8, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="model" tick={{ fontSize: 12, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis domain={yDomain} tickFormatter={(v) => formatNum(v)} width={78} tick={{ fontSize: 12, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <Tooltip contentStyle={{ backgroundColor: "#070b16", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", color: "#fff" }} formatter={(val: any) => [formatNum(val), t.forecast]} />
                <Bar dataKey="value" name={t.forecast} fill="#22d3ee" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20">
            <div className="border-b border-white/10 bg-black/30 px-4 py-3 text-sm font-medium text-white">{t.modelValues} H={horizon}</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-black/60">
                  <tr className="text-left">
                    <th className="border-b border-white/10 px-3 py-2 text-slate-300">{t.model}</th>
                    <th className="border-b border-white/10 px-3 py-2 text-slate-300">{t.value}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr><td className="px-3 py-3 text-slate-400" colSpan={2}>{t.loading}</td></tr> : null}
                  {!loading && !modelOptions.length ? <tr><td className="px-3 py-3 text-slate-400" colSpan={2}>{t.noForecastData}</td></tr> : null}
                  {!loading && modelOptions.map((m) => (
                    <tr key={m.key} className="border-t border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 text-white">{m.label}</td>
                      <td className="px-3 py-2 font-mono text-white">{formatNum(bestRow?.[m.key])}</td>
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
