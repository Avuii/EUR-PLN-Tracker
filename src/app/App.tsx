// src/app/App.tsx
import DashboardTab from "./components/DashboardTab";
import DataTab from "./components/DataTab";
import ForecastTab from "./components/ForecastTab";
import ModelErrorsTab from "./components/ModelErrorsTab";
import ChartsTab from "./components/ChartsTab";
import LogsTab from "./components/LogsTab";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* HEADER */}
      <div className="px-6 pt-6 pb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
          €
        </div>
        <div className="text-xl font-semibold">Prognoza EUR/PLN</div>
      </div>

      {/* TABS */}
      <div className="px-6 pb-10">
        <Tabs defaultValue="dashboard" className="w-full">
          {/* TOP NAV (rounded/pill) */}
          <TabsList
            className="
              w-full justify-start gap-1
              bg-white/5 border border-white/10
              rounded-full p-1
              backdrop-blur-xl shadow-xl
            "
          >
            {[
              { v: "dashboard", t: "Panel główny" },
              { v: "data", t: "Dane" },
              { v: "forecast", t: "Predykcje" },
              { v: "errors", t: "Analiza błędów" },
              { v: "charts", t: "Wykresy" },
              { v: "logs", t: "Logi" },
            ].map((x) => (
              <TabsTrigger
                key={x.v}
                value={x.v}
                className="
                  rounded-full px-5 py-2 text-sm
                  text-gray-300
                  hover:text-white hover:bg-white/5
                  data-[state=active]:text-white
                  data-[state=active]:bg-cyan-500/15
                  data-[state=active]:border data-[state=active]:border-cyan-400/30
                  data-[state=active]:shadow-[0_0_18px_rgba(34,211,238,0.35)]
                  transition
                "
              >
                {x.t}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-6">
            <TabsContent value="dashboard">
              <DashboardTab />
            </TabsContent>

            <TabsContent value="data">
              <DataTab />
            </TabsContent>

            <TabsContent value="forecast">
              <ForecastTab />
            </TabsContent>

            <TabsContent value="errors">
              <ModelErrorsTab />
            </TabsContent>

            <TabsContent value="charts">
              <ChartsTab />
            </TabsContent>

            <TabsContent value="logs">
              <LogsTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
