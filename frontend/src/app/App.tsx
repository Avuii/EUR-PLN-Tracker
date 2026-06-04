import {
  BarChart3,
  BrainCircuit,
  Database,
  FileText,
  LayoutDashboard,
  Target,
  TrendingUp,
} from "lucide-react";

import DashboardTab from "./components/DashboardTab";
import DataTab from "./components/DataTab";
import ForecastTab from "./components/ForecastTab";
import ChartsTab from "./components/ChartsTab";
import ModelErrorsTab from "./components/ModelErrorsTab";
import ModelsTab from "./components/ModelsTab";
import LogsTab from "./components/LogsTab";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

const tabs = [
  { value: "summary", label: "Podsumowanie", icon: LayoutDashboard },
  { value: "data", label: "Dane", icon: Database },
  { value: "forecast", label: "Prognozy", icon: TrendingUp },
  { value: "eval", label: "Ewaluacja", icon: BarChart3 },
  { value: "errors", label: "Analiza błędów", icon: Target },
  { value: "models", label: "Modele", icon: BrainCircuit },
  { value: "logs", label: "Logi", icon: FileText },
];

export default function App() {
  return (
    <div className="app-shell min-h-screen text-white">
      <div className="app-grid" />

      <Tabs defaultValue="summary" className="relative z-10 w-full">
        <header className="app-header">
          <div className="app-header-inner">
            <div className="app-brand-row">
              <div className="app-logo" aria-hidden="true">
                <div className="app-logo-orb">
                  <span className="app-logo-euro">€</span>

                  <svg
                    className="app-logo-chart"
                    viewBox="0 0 48 24"
                    fill="none"
                  >
                    <path
                      d="M3 17.5L11 13.5L18 15.5L27 7.5L35 10.5L45 4.5"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="27" cy="7.5" r="2.5" fill="currentColor" />
                  </svg>
                </div>
              </div>

              <div>
                <h1 className="app-title">Prognoza EUR/PLN</h1>
                <p className="app-subtitle">Panel predykcji kursu euro</p>
              </div>
            </div>

            <div className="app-tabs-wrap">
              <TabsList className="app-tabs-list">
                {tabs.map((tab) => {
                  const Icon = tab.icon;

                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="app-tab"
                    >
                      <Icon className="h-4 w-4" />
                      <span>{tab.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
        </header>

        <main className="app-main">
          <TabsContent value="summary" className="app-tab-content">
            <DashboardTab />
          </TabsContent>

          <TabsContent value="data" className="app-tab-content">
            <DataTab />
          </TabsContent>

          <TabsContent value="forecast" className="app-tab-content">
            <ForecastTab />
          </TabsContent>

          <TabsContent value="eval" className="app-tab-content">
            <ChartsTab />
          </TabsContent>

          <TabsContent value="errors" className="app-tab-content">
            <ModelErrorsTab />
          </TabsContent>

          <TabsContent value="models" className="app-tab-content">
            <ModelsTab />
          </TabsContent>

          <TabsContent value="logs" className="app-tab-content">
            <LogsTab />
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}