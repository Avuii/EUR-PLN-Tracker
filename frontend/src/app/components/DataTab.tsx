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

function withChanges(rows: Row[]) {
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const diff = prev ? row.value - prev.value : null;
    const pct = prev && prev.value !== 0 ? (diff as number) / prev.value * 100 : null;
    return { ...row, diff, pct };
  });
}

export default function DataTab() {
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
            <h2 className="text-2xl font-semibold text-white">Dane EUR/PLN</h2>
            <p className="mt-1 text-sm text-slate-400">Ostatnie obserwacje, zmiany dzienne i szybki podgląd trendu.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <span>Limit</span>
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
              {busy ? "Ładowanie..." : "Odśwież"}
            </Button>

            <Button variant="outline" className="app-button" onClick={handleExportXlsx}>
              <Download className="mr-2 h-4 w-4" />
              Eksportuj XLSX
            </Button>
          </div>
        </div>
      </Card>

      {err ? (
        <Card className="app-card rounded-3xl border-red-500/30 bg-red-500/10 p-4">
          <div className="text-sm text-red-200">Błąd: {err}</div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">Najnowszy kurs</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.latest?.value)} zł</div>
          <div className="mt-2 text-xs text-slate-500">{fmtDate(stats.latest?.date ?? "")}</div>
        </Card>
        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">Średnia z widoku</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.avg)} zł</div>
        </Card>
        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">Minimum</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.min)} zł</div>
        </Card>
        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">Maksimum</div>
          <div className="mt-3 text-2xl font-semibold text-white">{fmt4(stats.max)} zł</div>
        </Card>
        <Card className="app-kpi p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400">Zmiana w widoku</div>
          <div className={`mt-3 text-2xl font-semibold ${stats.totalChange != null && stats.totalChange < 0 ? "text-red-300" : "text-emerald-300"}`}>
            {fmt4(stats.totalChange)} zł
          </div>
        </Card>
      </div>

      <Card className="app-card rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Trend kursu</h3>
          <span className="text-sm text-slate-400">{rows.length} punktów</span>
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 12, right: 18, left: 8, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 12, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} minTickGap={28} />
              <YAxis domain={yDomain} tickFormatter={(v) => fmt4(Number(v))} width={78} tick={{ fontSize: 12, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#070b16", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", color: "#fff" }}
                formatter={(val: any) => [fmt4(Number(val)), "EUR/PLN"]}
                labelFormatter={(l) => `Data: ${fmtDate(String(l))}`}
              />
              <Line type="monotone" dataKey="value" dot={false} strokeWidth={2.5} stroke="#f59e0b" name="EUR/PLN" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="app-card rounded-3xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">Ostatnie rekordy</h3>
          <p className="text-sm text-slate-400">Tabela pokazuje najnowsze dane na górze oraz zmianę względem poprzedniego notowania.</p>
        </div>
        <div className="max-h-[560px] overflow-auto rounded-2xl border border-white/10">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-black/70 backdrop-blur-xl">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-slate-300">Data</TableHead>
                <TableHead className="text-slate-300">Kurs</TableHead>
                <TableHead className="text-slate-300">Zmiana</TableHead>
                <TableHead className="text-slate-300">Zmiana %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newestFirst.length === 0 ? (
                <TableRow className="border-white/5">
                  <TableCell className="text-slate-400" colSpan={4}>Brak danych.</TableCell>
                </TableRow>
              ) : (
                newestFirst.map((row, index) => (
                  <TableRow key={`${row.date}-${index}`} className="border-white/5 transition-colors hover:bg-white/5">
                    <TableCell className="font-mono text-sm text-white">{fmtDate(row.date)}</TableCell>
                    <TableCell className="font-mono text-sm text-white">{fmt4(row.value)}</TableCell>
                    <TableCell className={`font-mono text-sm ${row.diff != null && row.diff < 0 ? "text-red-300" : "text-emerald-300"}`}>{fmt4(row.diff)}</TableCell>
                    <TableCell className={`font-mono text-sm ${row.pct != null && row.pct < 0 ? "text-red-300" : "text-emerald-300"}`}>{row.pct == null ? "—" : `${fmt2(row.pct)}%`}</TableCell>
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
