import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Copy, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { yDomainFromData } from "../lib/chartDomain";

export default function LogsTab() {
  const [logs, setLogs] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.logs();
        setLogs(r.logs ?? "");
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(logs);
    } catch {
      // ignore
    }
  }

  function handleClear() {
    // czyścimy tylko widok; backendowy log zostaje (celowo)
    setLogs("");
  }

  async function handleReload() {
    try {
      setErr("");
      const r = await api.logs();
      setLogs(r.logs ?? "");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2>Logs</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReload}
            className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
          >
            Odśwież
          </button>
          <button
            onClick={handleCopy}
            className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all flex items-center gap-2"
          >
            <Copy size={14} /> Copy
          </button>
          <button
            onClick={handleClear}
            className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all flex items-center gap-2"
          >
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-2xl">
          <div className="text-red-200 text-sm">Błąd: {err}</div>
        </Card>
      ) : null}

      <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10 p-6 rounded-2xl backdrop-blur-xl shadow-xl">
        <div className="bg-[#0a0e1a] border border-white/5 rounded-xl p-4 text-xs text-gray-400 font-mono h-[70vh] overflow-y-auto backdrop-blur-sm whitespace-pre-wrap">
          {logs || "Brak logów. Uruchom Run w Dashboard."}
        </div>
      </Card>
    </div>
  );
}
