import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Copy, Trash2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

type Lang = "pl" | "en";

type Props = {
  lang: Lang;
};

const text = {
  pl: {
    title: "Logi",
    subtitle: "Podgląd logów backendu z uruchomień fetch / train / run",
    refresh: "Odśwież",
    copy: "Copy",
    clear: "Clear",
    error: "Błąd",
    console: "Console output",
    loading: "Ładowanie logów...",
    empty: "Brak logów. Uruchom Run w Dashboard.",
  },
  en: {
    title: "Logs",
    subtitle: "Backend logs from fetch / train / run executions",
    refresh: "Refresh",
    copy: "Copy",
    clear: "Clear",
    error: "Error",
    console: "Console output",
    loading: "Loading logs...",
    empty: "No logs. Run the experiment from Dashboard.",
  },
};

export default function LogsTab({ lang }: Props) {
  const t = text[lang];
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
    <div className="app-page space-y-6">
      <Card className="app-card rounded-3xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-white/90 text-xl font-semibold">{t.title}</h2>
            <p className="text-sm text-gray-400 mt-1">
              {t.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              className="text-xs text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-2xl transition-all flex items-center gap-2"
            >
              <RefreshCw size={14} />
              {t.refresh}
            </button>

            <button
              onClick={handleCopy}
              className="text-xs text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-2xl transition-all flex items-center gap-2"
            >
              <Copy size={14} />
              Copy
            </button>

            <button
              onClick={handleClear}
              className="text-xs text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-2xl transition-all flex items-center gap-2"
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
        </div>
      </Card>

      {err ? (
        <Card className="bg-red-500/10 border-red-500/20 p-4 rounded-3xl">
          <div className="text-red-200 text-sm">{t.error}: {err}</div>
        </Card>
      ) : null}

      <Card className="app-card rounded-3xl p-6">
        <div className="rounded-2xl border border-white/10 bg-black/35 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-black/25 text-xs uppercase tracking-wider text-gray-400">
            {t.console}
          </div>

          <div className="p-4 font-mono text-xs text-gray-300 h-[70vh] overflow-y-auto whitespace-pre-wrap bg-black/40">
            {loading ? t.loading : logs || t.empty}
          </div>
        </div>
      </Card>
    </div>
  );
}