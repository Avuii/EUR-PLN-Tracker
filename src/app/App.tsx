import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import DashboardTab from "./components/DashboardTab";
import DataTab from "./components/DataTab";
import ForecastTab from "./components/ForecastTab";
import ChartsTab from "./components/ChartsTab";
import ModelErrorsTab from "./components/ModelErrorsTab";
import LogsTab from "./components/LogsTab";
import { Settings, RotateCw } from "lucide-react";
import { Button } from "./components/ui/button";
import { useEffect, useState } from "react";
import { api, Results, RunParams } from "./lib/api";

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [results, setResults] = useState<Results | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await api.results();
        setResults(r);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  async function reload() {
    try {
      setBusy(true);
      setErr("");
      const r = await api.results();
      setResults(r);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="dark min-h-screen bg-black text-white">
      {/* Top Bar */}
      <div className="border-b border-white/10 bg-black/50 backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-[0_4px_20px_rgba(34,211,238,0.4)]">
              <span className="text-xl">€</span>
            </div>
            <h1 className="text-xl tracking-tight">Prognoza EUR/PLN</h1>
          </div>
        </div>
  
      </div>

      {/* Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="border-b border-white/10 bg-black/30 backdrop-blur-xl px-6">
          <TabsList className="bg-transparent h-12 p-0 gap-8">
            <TabsTrigger
              value="dashboard"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 rounded-none pb-3 text-gray-400 data-[state=active]:text-white hover:text-white data-[state=active]:shadow-[0_2px_12px_rgba(34,211,238,0.3)] transition-all"
            >
              Panel główny
            </TabsTrigger>
            <TabsTrigger
              value="dane"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 rounded-none pb-3 text-gray-400 data-[state=active]:text-white hover:text-white data-[state=active]:shadow-[0_2px_12px_rgba(34,211,238,0.3)] transition-all"
            >
              Dane
            </TabsTrigger>
            <TabsTrigger
              value="prognoza"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 rounded-none pb-3 text-gray-400 data-[state=active]:text-white hover:text-white data-[state=active]:shadow-[0_2px_12px_rgba(34,211,238,0.3)] transition-all"
            >
              Predykcje
            </TabsTrigger>
            <TabsTrigger
              value="test"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 rounded-none pb-3 text-gray-400 data-[state=active]:text-white hover:text-white data-[state=active]:shadow-[0_2px_12px_rgba(34,211,238,0.3)] transition-all"
            >
              Analiza błędów
            </TabsTrigger>
            <TabsTrigger
              value="wykresy"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 rounded-none pb-3 text-gray-400 data-[state=active]:text-white hover:text-white data-[state=active]:shadow-[0_2px_12px_rgba(34,211,238,0.3)] transition-all"
            >
              Wykresy
            </TabsTrigger>
            <TabsTrigger
              value="logi"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 rounded-none pb-3 text-gray-400 data-[state=active]:text-white hover:text-white data-[state=active]:shadow-[0_2px_12px_rgba(34,211,238,0.3)] transition-all"
            >
              Logi
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <div className="p-8">
          <TabsContent value="dashboard" className="mt-0">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="dane" className="mt-0">
            <DataTab />
          </TabsContent>
          <TabsContent value="prognoza" className="mt-0">
            <ForecastTab />
          </TabsContent>
          <TabsContent value="test" className="mt-0">
            <ModelErrorsTab />
          </TabsContent>
          <TabsContent value="wykresy" className="mt-0">
            <ChartsTab />
          </TabsContent>
          <TabsContent value="bledy" className="mt-0">
            <ModelErrorsTab />
          </TabsContent>
          <TabsContent value="logi" className="mt-0">
            <LogsTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}