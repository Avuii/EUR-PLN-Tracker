import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { api } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

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

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.data(limit);
        setRows(r.rows);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, [limit]);

  const count = rows.length;

  const handleExportXlsx = () => {
    // backend endpoint (Excel). Jeśli nie masz jeszcze endpointu, możesz tymczasowo użyć CSV:
    // window.open("/api/artifacts/eur_a.csv", "_blank");
    window.open(`/api/export/data.xlsx?limit=${limit}`, "_blank");
  };

  const handleReload = async () => {
    try {
      setBusy(true);
      setErr("");
      const r = await api.data(limit);
      setRows(r.rows);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2>Dane historyczne EUR/PLN</h2>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>Limit:</span>
            <input
              type="number"
              min={50}
              max={20000}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-right"
            />
          </div>

          <Button
            variant="outline"
            className="bg-white/5 border-white/10 hover:bg-white/10 rounded-xl"
            onClick={handleReload}
            disabled={busy}
          >
            {busy ? "Ładowanie..." : "Odśwież"}
          </Button>

          <Button
            variant="outline"
            className="bg-white/5 border-white/10 hover:bg-white/10 rounded-xl"
            onClick={handleExportXlsx}
          >
            Eksportuj do XLSX
          </Button>
        </div>
      </div>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 rounded-2xl backdrop-blur-xl shadow-xl overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-200px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-[#0a0e1a] z-10">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Data</TableHead>
                <TableHead className="text-gray-400">Kurs</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="border-white/5">
                  <TableCell className="text-gray-500" colSpan={2}>
                    Brak danych (uruchom Run albo Fetch).
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow
                    key={index}
                    className="border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <TableCell className="font-mono text-sm">{row.date}</TableCell>
                    <TableCell className="font-mono text-sm">{fmt4(row.value)}</TableCell>
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
