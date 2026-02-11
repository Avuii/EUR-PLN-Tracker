// src/app/components/ModelsTab.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { fetchResults, type MetricsPayload } from "../lib/api";

function safeJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

export default function ModelsTab() {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);

  useEffect(() => {
    fetchResults()
      .then((r) => setMetrics(r.metrics ?? null))
      .catch(() => setMetrics(null));
  }, []);

  const ridgeParams = useMemo(() => (metrics as any)?.ridge_best_params ?? null, [metrics]);
  const rfParams = useMemo(() => (metrics as any)?.rf_best_params ?? null, [metrics]);

  const featureList = [
    "Lagi: lag_1, lag_2, lag_3, lag_5, lag_10, lag_20",
    "Log-return: logret_1",
    "Rolling mean: roll_mean_5, roll_mean_10",
    "Rolling std: roll_std_5, roll_std_10",
    "Volatility: vol_10",
    "Day-of-week: dow",
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-white">Modele</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-white/70 space-y-3">
          <div>
            <div className="text-white/80 font-medium mb-1">Cechy wejściowe</div>
            <ul className="list-disc pl-5 space-y-1">
              {featureList.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              Baseline
              <Badge className="bg-white/10 text-white/80 border border-white/10">
                punkt odniesienia
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/70 space-y-2">
            Prognozuje jutro jako dziś (persistence), ewentualnie MA(5) lub momentum.
          </CardContent>
        </Card>

        <Card className="bg-purple-500/10 border-purple-400/20 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.15)]">
          <CardHeader>
            <CardTitle className="text-white">Ridge (Δ)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/70 space-y-2">
            <div>Model liniowy przewidujący DELTA, potem poziom = dziś + Δ.</div>
            <pre className="mt-2 text-xs bg-black/30 border border-white/10 rounded-xl p-3 overflow-auto">
              {ridgeParams ? safeJson(ridgeParams) : "Brak (no-tuning lub brak w backendzie)."}
            </pre>
          </CardContent>
        </Card>

        <Card className="bg-cyan-500/10 border-cyan-400/20 backdrop-blur-xl shadow-[0_0_30px_rgba(34,211,238,0.12)]">
          <CardHeader>
            <CardTitle className="text-white">RandomForest (Δ)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/70 space-y-2">
            <div>Nieliniowy model drzewiasty przewidujący DELTA.</div>
            <pre className="mt-2 text-xs bg-black/30 border border-white/10 rounded-xl p-3 overflow-auto">
              {rfParams ? safeJson(rfParams) : "Brak (no-tuning lub brak w backendzie)."}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
