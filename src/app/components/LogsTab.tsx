import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Copy, Trash2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

export default function LogsTab() {
  const [logs, setLogs] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function loadLogs() {
    try {
      setLoading(true);
      setErr("");
      const r = await api.logs();
      setLogs(r.text ?? "");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(logs);
    } catch {
      // ignore
    }
  }

  function handleClear() {
    // czyścimy tylko widok; backendowy log zostaje
    setLogs("");
  }

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-5 rounded-2xl backdrop-blur-xl shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-white/90 text-xl font-semibold">Logi</h2>
            <p className="text-sm text-gray-400 mt-1">
              Podgląd logów backendu z uruchomień fetch / train / run
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              className="text-xs text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-xl transition-all flex items-center gap-2"
            >
              <RefreshCw size={14} />
              Odśwież
            </button>

            <button
              onClick={handleCopy}
              className="text-xs text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-xl transition-all flex items-center gap-2"
            >
              <Copy size={14} />
              Copy
            </button>

            <button
              onClick={handleClear}
              className="text-xs text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-xl transition-all flex items-center gap-2"
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
        </div>
      </Card>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-black/20 text-xs uppercase tracking-wider text-gray-400">
            Console output
          </div>

          <div className="p-4 font-mono text-xs text-gray-300 h-[70vh] overflow-y-auto whitespace-pre-wrap bg-black/40">
            {loading ? "Ładowanie logów..." : logs || "Brak logów. Uruchom Run w Dashboard."}
          </div>
        </div>
      </Card>
    </div>
  );
}