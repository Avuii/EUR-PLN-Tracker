import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api } from "../lib/api";

const MODEL_META: Record<string, { family: string; short: string; description: string; accent: string }> = {
  Naive: {
    family: "Baseline",
    short: "Persistence",
    description: "Najprostszy punkt odniesienia: zakłada, że przyszły kurs będzie równy ostatniej znanej wartości.",
    accent: "border-slate-300/15 bg-slate-400/10 text-slate-200",
  },
  SMA: {
    family: "Baseline",
    short: "Moving Average",
    description: "Prognoza oparta o średnią kroczącą z ostatnich obserwacji.",
    accent: "border-cyan-300/15 bg-cyan-400/10 text-cyan-200",
  },
  EMA: {
    family: "Baseline",
    short: "Exp. Average",
    description: "Wygładzanie wykładnicze, które mocniej waży nowsze obserwacje.",
    accent: "border-blue-300/15 bg-blue-400/10 text-blue-200",
  },
  Ridge: {
    family: "Linear",
    short: "L2 regularization",
    description: "Model liniowy z regularyzacją L2. Stabilizuje współczynniki przy wielu cechach opóźnionych i kroczących.",
    accent: "border-purple-300/20 bg-purple-400/10 text-purple-200",
  },
  ElasticNet: {
    family: "Linear",
    short: "L1 + L2",
    description: "Model liniowy łączący regularyzację L1 i L2. Może ograniczać wpływ słabszych cech.",
    accent: "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-200",
  },
  RandomForest: {
    family: "Tree Ensemble",
    short: "Bagging",
    description: "Zespół wielu drzew decyzyjnych. Dobrze działa jako mocny model nieliniowy dla danych tabelarycznych.",
    accent: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
  },
  ExtraTrees: {
    family: "Tree Ensemble",
    short: "Randomized trees",
    description: "Podobny do RandomForest, ale używa większej losowości przy podziałach, co czasem poprawia generalizację.",
    accent: "border-teal-300/20 bg-teal-400/10 text-teal-200",
  },
  HistGB: {
    family: "Boosting",
    short: "Gradient Boosting",
    description: "Boosting drzew oparty o histogramy. Kolejne drzewa poprawiają błędy poprzednich.",
    accent: "border-pink-300/20 bg-pink-400/10 text-pink-200",
  },
  SARIMAX: {
    family: "Time Series",
    short: "Classical TS",
    description: "Klasyczny model szeregów czasowych używany jako dodatkowy punkt porównania.",
    accent: "border-amber-300/20 bg-amber-400/10 text-amber-200",
  },
  MLPRegressor: {
    family: "Neural",
    short: "MLP",
    description: "Prosta sieć neuronowa dla regresji tabelarycznej. W projekcie pełni rolę dodatkowego benchmarku.",
    accent: "border-indigo-300/20 bg-indigo-400/10 text-indigo-200",
  },
  XGBoost: {
    family: "Boosting",
    short: "Optional",
    description: "Opcjonalny backend boostingowy, aktywny tylko jeśli jest włączony w konfiguracji i dostępny w środowisku.",
    accent: "border-orange-300/20 bg-orange-400/10 text-orange-200",
  },
  LightGBM: {
    family: "Boosting",
    short: "Optional",
    description: "Opcjonalny backend boostingowy, aktywny tylko jeśli jest włączony w konfiguracji i dostępny w środowisku.",
    accent: "border-lime-300/20 bg-lime-400/10 text-lime-200",
  },
};

function fmt4(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(".", ",");
}

function fmtPct(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n > 1 && n <= 100 ? n : n * 100).toFixed(2).replace(".", ",")}%`;
}

function safeJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function getHorizons(metrics: any) {
  const byH = metrics?.by_horizon ?? {};
  return Object.keys(byH)
    .map((h) => Number(h))
    .filter((h) => Number.isFinite(h))
    .sort((a, b) => a - b);
}

export default function ModelsTab() {
  const [results, setResults] = useState<any>(null);
  const [horizon, setHorizon] = useState<number>(30);

  useEffect(() => {
    api.results()
      .then((r) => setResults(r))
      .catch(() => setResults(null));
  }, []);

  const metrics = results?.metrics ?? null;
  const runConfig = results?.runConfig ?? null;

  const horizons = useMemo(() => getHorizons(metrics), [metrics]);

  useEffect(() => {
    if (horizons.length && !horizons.includes(horizon)) {
      setHorizon(horizons.includes(30) ? 30 : horizons[0]);
    }
  }, [horizons, horizon]);

  const horizonNode = metrics?.by_horizon?.[String(horizon)] ?? null;
  const bestModel = horizonNode?.best_model ?? "—";
  const models = horizonNode?.models && typeof horizonNode.models === "object" ? Object.entries(horizonNode.models) : [];
  const features = Array.isArray(runConfig?.models_enabled) ? runConfig.models_enabled : [];

  return (
    <div className="app-page space-y-6">
      <Card className="premium-card rounded-3xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl text-white">Modele</CardTitle>
        </CardHeader>

        <CardContent className="space-y-5 text-sm text-white/80">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="mb-2 text-white font-medium">Horyzont</div>
              <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
                <SelectTrigger className="app-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#070b16] text-white">
                  {horizons.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      H={h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="mb-2 text-white font-medium">Konfiguracja</div>
              <div className="space-y-2 text-slate-300">
                <div><span className="text-slate-400">Para:</span> <span className="text-white">{runConfig?.pair ?? results?.summary?.pair ?? "EUR/PLN"}</span></div>
                <div><span className="text-slate-400">Window mode:</span> <span className="text-white">{runConfig?.window_mode ?? "—"}</span></div>
                <div><span className="text-slate-400">Seed:</span> <span className="text-white">{runConfig?.seed ?? "—"}</span></div>
              </div>
            </div>

            <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-4 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
              <div className="mb-2 text-white font-medium">Best model</div>
              <div className="text-2xl font-semibold text-white">{bestModel}</div>
              <div className="mt-2 text-xs text-cyan-100/75">Wybrany na podstawie walidacji dla H={horizon}</div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
            <div className="mb-3 text-white font-medium">Modele w konfiguracji</div>
            <div className="flex flex-wrap gap-2">
              {(features.length ? features : Object.keys(MODEL_META)).map((f: string) => (
                <Badge key={f} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {models.length ? models.map(([name, value]: any) => {
          const meta = MODEL_META[name] ?? {
            family: "Model",
            short: name,
            description: "Model zwrócony przez aktualny pipeline eksperymentu.",
            accent: "border-white/10 bg-white/5 text-white/80",
          };
          const val = value?.val ?? null;
          const test = value?.test ?? null;
          const isBest = bestModel === name;

          return (
            <Card key={name} className="premium-card rounded-3xl">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg text-white">{name}</CardTitle>
                  <Badge className={`border ${meta.accent}`}>{meta.short}</Badge>
                  <Badge className="border border-white/10 bg-white/5 text-white/70">{meta.family}</Badge>
                  {isBest ? <Badge className="border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">best on val</Badge> : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                <div className="text-white/75">{meta.description}</div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Validation</div>
                    <div className="space-y-1 text-slate-300">
                      <div>MAE: <span className="font-medium text-white">{fmt4(val?.mae)}</span></div>
                      <div>RMSE: <span className="font-medium text-white">{fmt4(val?.rmse)}</span></div>
                      <div>MAPE: <span className="font-medium text-white">{fmtPct(val?.mape_pct)}</span></div>
                      <div>DirAcc: <span className="font-medium text-white">{fmtPct(val?.dir_acc)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Test</div>
                    <div className="space-y-1 text-slate-300">
                      <div>MAE: <span className="font-medium text-white">{fmt4(test?.mae)}</span></div>
                      <div>RMSE: <span className="font-medium text-white">{fmt4(test?.rmse)}</span></div>
                      <div>MAPE: <span className="font-medium text-white">{fmtPct(test?.mape_pct)}</span></div>
                      <div>DirAcc: <span className="font-medium text-white">{fmtPct(test?.dir_acc)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Surowe metryki</div>
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-xs text-slate-200">{safeJson(value)}</pre>
                </div>
              </CardContent>
            </Card>
          );
        }) : (
          <Card className="premium-card rounded-3xl p-5 text-sm text-slate-300">
            Brak metryk modeli. Uruchom pipeline albo sprawdź, czy backend widzi najnowszy folder w runs.
          </Card>
        )}
      </div>
    </div>
  );
}
