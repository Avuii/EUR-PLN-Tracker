import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { api, API_URL } from "../lib/api";
import { RefreshCw, Download } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { yDomainFromData } from "../lib/chartDomain";

type Row = { date: string; value: number };

function fmt4(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(4).replace(".", ",");
}

function fmt2(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(2).replace(".", ",");
}

function fmtDate(v: string) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function changeColorClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "rate-change-zero";
  }

  if (value > 0) {
    return "rate-change-positive";
  }

  if (value < 0) {
    return "rate-change-negative";
  }

  return "rate-change-zero";
}

function withChanges(rows: Row[]) {
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const diff = prev ? row.value - prev.value : null;
    const pct = prev && prev.value !== 0 ? ((diff as number) / prev.value) * 100 : null;
    return { ...row, diff, pct };
  });
}

type Lang = "pl" | "en";

type Props = {
  lang: Lang;
};

const text = {
  pl: {
    title: "Dane EUR/PLN",
    subtitle: "Ostatnie obserwacje, zmiany dzienne i szybki podgląd trendu.",
    limit: "Limit",
    loading: "Ładowanie...",
    refresh: "Odśwież",
    exportXlsx: "Eksportuj XLSX",
    error: "Błąd",
    latestRate: "Najnowszy kurs",
    viewAverage: "Średnia z widoku",
    min: "Minimum",
    max: "Maksimum",
    viewChange: "Zmiana w widoku",
    trendTitle: "Trend kursu",
    points: "punktów",
    tooltipDate: "Data",
    recentRows: "Ostatnie rekordy",
    recentRowsSubtitle: "Tabela pokazuje najnowsze dane na górze oraz zmianę względem poprzedniego notowania.",
    date: "Data",
    rate: "Kurs",
    change: "Zmiana",
    changePct: "Zmiana %",
    noData: "Brak danych.",
  },
  en: {
    title: "EUR/PLN Data",
    subtitle: "Recent observations, daily changes, and a quick trend preview.",
    limit: "Limit",
    loading: "Loading...",
    refresh: "Refresh",
    exportXlsx: "Export XLSX",
    error: "Error",
    latestRate: "Latest rate",
    viewAverage: "View average",
    min: "Minimum",
    max: "Maximum",
    viewChange: "Change in view",
    trendTitle: "Exchange rate trend",
    points: "points",
    tooltipDate: "Date",
    recentRows: "Recent records",
    recentRowsSubtitle: "The table shows the newest data first and the change versus the previous quotation.",
    date: "Date",
    rate: "Rate",
    change: "Change",
    changePct: "Change %",
    noData: "No data.",
  },
};

export default function DataTab({ lang }: Props) {
  const t = text[lang];
  const [rows, setRows] = useState<Row[]>([]);
  const [limit, setLimit] = useState(500);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function loadData(currentLimit = limit) {
    try {
      setErr("");
      const r = await api.data(currentLimit);
      setRows(r.rows ?? []);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    loadData(limit);
  }, [limit]);

  const enriched = useMemo(() => withChanges(rows), [rows]);
  const newestFirst = useMemo(() => enriched.slice().reverse(), [enriched]);

  const stats = useMemo(() => {
    const vals = rows.map((r) => r.value).filter((v) => Number.isFinite(v));
    const latest = rows.length ? rows[rows.length - 1] : null;
    const first = rows[0] ?? null;
    const min = vals.length ? Math.min(...vals) : null;
    const max = vals.length ? Math.max(...vals) : null;
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const totalChange = latest && first ? latest.value - first.value : null;
    return { latest, min, max, avg, totalChange };
  }, [rows]);

  const yDomain = useMemo(() => yDomainFromData(rows, ["value"], 0.08, 0.01), [rows]);

  const handleExportXlsx = () => {
    window.open(`${API_URL}/api/export/data.xlsx?limit=${limit}`, "_blank");
  };

  const handleReload = async () => {
    try {
      setBusy(true);
      await loadData(limit);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page space-y-6">
      <Card className="app-card rounded-3xl p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">{t.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{t.subtitle}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <span>{t.limit}</span>
              <input
                type="number"
                min={50}
                max={20000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="app-input w-28 px-3 py-2 text-right"
              />
            </label>

            <Button variant="outline" className="app-button" onClick={handleReload} disabled={busy}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {busy ? t.loading : t.refresh}
            </Button>

            <Button variant="outline" className="app-button" onClick={handleExportXlsx}>
              <Download className="mr-2 h-4 w-4" />
              {t.exportXlsx}
            </Button>
          </div>
        </div>
      </Card>

      {err ? (
        <Card className="app-card rounded-3xl border-red-500/30 bg-red-500/10 p-4">
          <div className="text-sm text-red-200">{t.error}: {err}</div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">{t.latestRate}</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.latest?.value)} zł</div>
          <div className="mt-2 text-xs text-slate-500">{fmtDate(stats.latest?.date ?? "")}</div>
        </Card>

        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">{t.viewAverage}</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.avg)} zł</div>
        </Card>

        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">{t.min}</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.min)} zł</div>
        </Card>

        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">{t.max}</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.max)} zł</div>
        </Card>

        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">{t.viewChange}</div>
          <div className={`mt-3 text-2xl font-semibold ${changeColorClass(stats.totalChange)}`}>
            {fmt4(stats.totalChange)} zł
          </div>
        </Card>
      </div>

      <Card className="app-card rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{t.trendTitle}</h3>
          <span className="text-sm text-slate-400">
            {rows.length} {t.points}
          </span>
        </div>

        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 12, right: 18, left: 8, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                minTickGap={28}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => fmt4(Number(v))}
                width={78}
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#070b16",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "16px",
                  color: "#fff",
                }}
                formatter={(val: any) => [fmt4(Number(val)), "EUR/PLN"]}
                labelFormatter={(l) => `${t.tooltipDate}: ${fmtDate(String(l))}`}
              />
              <Line type="monotone" dataKey="value" dot={false} strokeWidth={2.5} stroke="#f59e0b" name="EUR/PLN" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="app-card rounded-3xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">{t.recentRows}</h3>
          <p className="text-sm text-slate-400">{t.recentRowsSubtitle}</p>
        </div>

        <div className="max-h-[560px] overflow-auto rounded-2xl border border-white/10">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-black/70 backdrop-blur-xl">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-slate-300">{t.date}</TableHead>
                <TableHead className="text-slate-300">{t.rate}</TableHead>
                <TableHead className="text-slate-300">{t.change}</TableHead>
                <TableHead className="text-slate-300">{t.changePct}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {newestFirst.length === 0 ? (
                <TableRow className="border-white/5">
                  <TableCell className="text-slate-400" colSpan={4}>
                    {t.noData}
                  </TableCell>
                </TableRow>
              ) : (
                newestFirst.map((row, index) => (
                  <TableRow key={`${row.date}-${index}`} className="border-white/5 transition-colors hover:bg-white/5">
                    <TableCell className="font-mono text-sm text-white">{fmtDate(row.date)}</TableCell>
                    <TableCell className="font-mono text-sm text-white">{fmt4(row.value)}</TableCell>

                    <TableCell className={`font-mono text-sm ${changeColorClass(row.diff)}`}>
                      {fmt4(row.diff)}
                    </TableCell>

                    <TableCell className={`font-mono text-sm ${changeColorClass(row.pct)}`}>
                      {row.pct == null ? "—" : `${fmt2(row.pct)}%`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}