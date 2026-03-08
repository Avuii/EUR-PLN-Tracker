// src/app/components/ModelsTab.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { api } from "../lib/api";

type ResultsLike = {
  metrics?: any;
  runConfig?: any;
};

type ModelDef = {
  id: string;
  title: string;
  short: string;
  accent: string;
  border: string;
  glow: string;
  description: string;
  family: string;
};

const MODEL_DEFS: ModelDef[] = [
  {
    id: "baseline_persistence",
    title: "Baseline",
    short: "Persistence",
    accent: "bg-white/10 text-white/80",
    border: "border-white/10",
    glow: "",
    description: "Najprostszy punkt odniesienia: przewiduje, że jutrzejszy kurs będzie równy dzisiejszemu.",
    family: "Baseline",
  },
  {
    id: "baseline_ma5",
    title: "MA(5)",
    short: "Moving Average",
    accent: "bg-slate-400/10 text-slate-200",
    border: "border-slate-300/15",
    glow: "",
    description: "Prognoza oparta na krótkiej średniej kroczącej z ostatnich obserwacji.",
    family: "Baseline",
  },
  {
    id: "baseline_momentum",
    title: "Momentum",
    short: "Δ kontynuowany",
    accent: "bg-amber-400/10 text-amber-200",
    border: "border-amber-300/15",
    glow: "",
    description: "Zakłada kontynuację ostatniego ruchu: jutrzejszy poziom = dziś + (dziś − wczoraj).",
    family: "Baseline",
  },
  {
    id: "ridge_delta",
    title: "Ridge (Δ)",
    short: "Model liniowy",
    accent: "bg-purple-400/10 text-purple-200",
    border: "border-purple-400/20",
    glow: "shadow-[0_0_30px_rgba(168,85,247,0.12)]",
    description: "Model liniowy z regularyzacją L2. Przewiduje zmianę kursu (Δ), a poziom końcowy rekonstruowany jest jako dziś + Δ.",
    family: "Linear",
  },
  {
    id: "random_forest_delta",
    title: "RandomForest (Δ)",
    short: "Ensemble drzew",
    accent: "bg-cyan-400/10 text-cyan-200",
    border: "border-cyan-400/20",
    glow: "shadow-[0_0_30px_rgba(34,211,238,0.12)]",
    description: "Nieliniowy model zespołowy oparty na wielu drzewach decyzyjnych. Dobrze łapie zależności nieliniowe.",
    family: "Tree Ensemble",
  },
  {
    id: "extra_trees_delta",
    title: "ExtraTrees (Δ)",
    short: "Bardziej losowe drzewa",
    accent: "bg-emerald-400/10 text-emerald-200",
    border: "border-emerald-400/20",
    glow: "shadow-[0_0_30px_rgba(16,185,129,0.12)]",
    description: "Ensemble drzew podobny do RandomForest, ale z większą losowością podziałów. Często daje mocne wyniki na danych tabelarycznych.",
    family: "Tree Ensemble",
  },
  {
    id: "hist_gb_delta",
    title: "HistGB (Δ)",
    short: "Gradient Boosting",
    accent: "bg-pink-400/10 text-pink-200",
    border: "border-pink-400/20",
    glow: "shadow-[0_0_30px_rgba(244,114,182,0.12)]",
    description: "Histogram-based Gradient Boosting. Model boostingowy budujący kolejne drzewa minimalizujące błąd poprzednich.",
    family: "Boosting",
  },
];

function fmt4(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(".", ",");
}

function fmtPct(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

function safeJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function getParamsForModel(metrics: any, modelId: string) {
  const p = metrics?.params ?? {};

  switch (modelId) {
    case "ridge_delta":
      return p.ridge_best ?? metrics?.ridge_best_params ?? null;
    case "random_forest_delta":
      return p.rf_best ?? metrics?.rf_best_params ?? null;
    case "extra_trees_delta":
      return p.et_best ?? metrics?.et_best_params ?? null;
    case "hist_gb_delta":
      return p.hgb_best ?? metrics?.hgb_best_params ?? null;
    default:
      return null;
  }
}

function getModelMetrics(metrics: any, modelId: string) {
  return metrics?.models?.[modelId] ?? null;
}

export default function ModelsTab() {
  const [results, setResults] = useState<ResultsLike | null>(null);

  useEffect(() => {
    api.results()
      .then((r) => setResults(r))
      .catch(() => setResults(null));
  }, []);

  const metrics = results?.metrics ?? null;
  const runConfig = results?.runConfig ?? null;
  const bestModel = metrics?.best_model?.name ?? metrics?.best_model_name ?? null;

  const featureList = useMemo(() => {
    if (Array.isArray(runConfig?.features) && runConfig.features.length) {
      return runConfig.features as string[];
    }

    return [
      "lag_1",
      "lag_2",
      "lag_3",
      "lag_5",
      "lag_10",
      "lag_20",
      "logret_1",
      "roll_mean_5",
      "roll_mean_10",
      "roll_std_5",
      "roll_std_10",
      "vol_10",
      "dow",
    ];
  }, [runConfig]);

  const split = runConfig?.split ?? null;
  const sizes = runConfig?.sizes ?? null;

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 rounded-2xl backdrop-blur-xl shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-xl">Modele</CardTitle>
        </CardHeader>

        <CardContent className="space-y-5 text-sm text-white/80">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-white font-medium mb-2">Konfiguracja eksperymentu</div>
              <div className="space-y-2 text-gray-300">
                <div>
                  <span className="text-gray-400">Target:</span>{" "}
                  <span className="text-white">{runConfig?.target ?? "delta (t+1 - t)"}</span>
                </div>
                <div>
                  <span className="text-gray-400">Best model:</span>{" "}
                  <span className="text-white">{bestModel ?? "—"}</span>
                </div>
                <div>
                  <span className="text-gray-400">Tuning:</span>{" "}
                  <span className="text-white">
                    {runConfig?.tuning_enabled === true
                      ? "włączony"
                      : runConfig?.tuning_enabled === false
                        ? "wyłączony"
                        : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Zoom window:</span>{" "}
                  <span className="text-white">
                    {runConfig?.zoom_window_days != null ? `${runConfig.zoom_window_days} dni` : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-white font-medium mb-2">Split danych</div>
              <div className="space-y-2 text-gray-300">
                <div>
                  <span className="text-gray-400">Train:</span>{" "}
                  <span className="text-white">
                    {split?.train ? `${split.train.start} → ${split.train.end}` : "—"}
                    {sizes?.n_train != null ? ` (${sizes.n_train})` : ""}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Val:</span>{" "}
                  <span className="text-white">
                    {split?.val ? `${split.val.start} → ${split.val.end}` : "brak"}
                    {sizes?.n_val != null ? ` (${sizes.n_val})` : ""}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Test:</span>{" "}
                  <span className="text-white">
                    {split?.test ? `${split.test.start} → ${split.test.end}` : "—"}
                    {sizes?.n_test != null ? ` (${sizes.n_test})` : ""}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-white font-medium mb-3">Cechy wejściowe</div>
            <div className="flex flex-wrap gap-2">
              {featureList.map((f) => (
                <Badge
                  key={f}
                  className="bg-white/5 text-gray-200 border border-white/10 rounded-full px-3 py-1"
                >
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid xl:grid-cols-2 gap-6">
        {MODEL_DEFS.map((model) => {
          const mm = getModelMetrics(metrics, model.id);
          const params = getParamsForModel(metrics, model.id);
          const isBest = bestModel === model.id;

          const val = mm?.val ?? null;
          const test = mm?.test ?? null;

          return (
            <Card
              key={model.id}
              className={`bg-gradient-to-br from-white/5 to-white/[0.02] ${model.border} rounded-2xl backdrop-blur-xl ${model.glow}`}
            >
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-white text-lg">{model.title}</CardTitle>

                  <Badge className={`border ${model.accent}`}>
                    {model.short}
                  </Badge>

                  <Badge className="bg-white/5 text-white/70 border border-white/10">
                    {model.family}
                  </Badge>

                  {isBest ? (
                    <Badge className="bg-cyan-400/10 text-cyan-200 border border-cyan-400/20">
                      best on val
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                <div className="text-white/75">{model.description}</div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Validation</div>
                    <div className="space-y-1 text-gray-300">
                      <div>MAE: <span className="text-white font-medium">{fmt4(val?.mae)}</span></div>
                      <div>RMSE: <span className="text-white font-medium">{fmt4(val?.rmse)}</span></div>
                      <div>MAPE: <span className="text-white font-medium">{fmtPct(val?.mape_pct)}</span></div>
                      <div>DirAcc: <span className="text-white font-medium">{fmtPct(Number(val?.dir_acc) * 100)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Test</div>
                    <div className="space-y-1 text-gray-300">
                      <div>MAE: <span className="text-white font-medium">{fmt4(test?.mae)}</span></div>
                      <div>RMSE: <span className="text-white font-medium">{fmt4(test?.rmse)}</span></div>
                      <div>MAPE: <span className="text-white font-medium">{fmtPct(test?.mape_pct)}</span></div>
                      <div>DirAcc: <span className="text-white font-medium">{fmtPct(Number(test?.dir_acc) * 100)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Hiperparametry</div>
                  <pre className="text-xs text-gray-200 overflow-auto whitespace-pre-wrap">
                    {params ? safeJson(params) : "Brak parametrów strojenia (np. no-tuning albo baseline)."}
                  </pre>
                </div>

                {test ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Interpretacja</div>
                    <div className="text-gray-300">
                      Bias: <span className="text-white">{fmt4(test?.bias)}</span>
                      {" • "}
                      SMAPE: <span className="text-white">{fmtPct(test?.smape_pct)}</span>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}