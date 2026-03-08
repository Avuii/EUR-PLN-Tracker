import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { api, API_URL } from "../lib/api";
import { RefreshCw, Download } from "lucide-react";

type Row = { date: string; value: number };

function fmt4(x: number | null | undefined) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(4).replace(".", ",");
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

  const count = rows.length;

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
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-5 rounded-2xl backdrop-blur-xl shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-white text-xl font-semibold">Dane historyczne EUR/PLN</h2>
            <p className="text-sm text-gray-400 mt-1">Tabela kursów pobranych z backendu</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span>Limit:</span>
              <input
                type="number"
                min={50}
                max={20000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-24 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-right text-white placeholder:text-gray-500 outline-none focus:border-cyan-400/40"
              />
            </div>

            <Button
              variant="outline"
              className="bg-white/5 border-white/10 hover:bg-white/10 rounded-xl text-white"
              onClick={handleReload}
              disabled={busy}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {busy ? "Ładowanie..." : "Odśwież"}
            </Button>

            <Button
              variant="outline"
              className="bg-white/5 border-white/10 hover:bg-white/10 rounded-xl text-white"
              onClick={handleExportXlsx}
            >
              <Download className="mr-2 h-4 w-4" />
              Eksportuj do XLSX
            </Button>
          </div>
        </div>
      </Card>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 rounded-2xl backdrop-blur-xl shadow-xl overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-220px)] rounded-2xl">
          <Table>
            <TableHeader className="sticky top-0 bg-black/60 backdrop-blur-xl z-10">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-300 font-medium">Data</TableHead>
                <TableHead className="text-gray-300 font-medium">Kurs</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="border-white/5">
                  <TableCell className="text-gray-400" colSpan={2}>
                    Brak danych. Uruchom Fetch albo Run.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow
                    key={index}
                    className="border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <TableCell className="font-mono text-sm text-white">
                      {row.date}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-white">
                      {fmt4(row.value)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="text-sm text-gray-400">Wyświetlono {count} rekordów</div>
    </div>
  );
}