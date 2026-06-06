import { useEffect, useState } from "react";
import {
  BarChart3,
  BrainCircuit,
  Database,
  FileText,
  Languages,
  LayoutDashboard,
  Moon,
  Sun,
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

type Lang = "pl" | "en";
type Theme = "dark" | "light";

const labels = {
  pl: {
    title: "Prognoza EUR/PLN",
    subtitle: "Panel predykcji kursu euro",
    tabs: {
      summary: "Podsumowanie",
      data: "Dane",
      forecast: "Prognozy",
      eval: "Ewaluacja",
      errors: "Analiza błędów",
      models: "Modele",
      logs: "Logi",
    },
  },
  en: {
    title: "EUR/PLN Forecast",
    subtitle: "Euro exchange rate prediction panel",
    tabs: {
      summary: "Summary",
      data: "Data",
      forecast: "Forecasts",
      eval: "Evaluation",
      errors: "Error analysis",
      models: "Models",
      logs: "Logs",
    },
  },
};

const tabs = [
  { value: "summary", key: "summary", icon: LayoutDashboard },
  { value: "data", key: "data", icon: Database },
  { value: "forecast", key: "forecast", icon: TrendingUp },
  { value: "eval", key: "eval", icon: BarChart3 },
  { value: "errors", key: "errors", icon: Target },
  { value: "models", key: "models", icon: BrainCircuit },
  { value: "logs", key: "logs", icon: FileText },
] as const;

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem("lang");
    return saved === "en" ? "en" : "pl";
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const t = labels[lang];

  return (
    <div className="app-shell min-h-screen">
      <div className="app-grid" />

      <Tabs defaultValue="summary" className="relative z-10 w-full">
        <header className="app-header">
          <div className="app-header-inner">
            <div className="app-top-row">
              <div className="app-brand-row">
                <div className="app-logo" aria-hidden="true">
                  <div className="app-logo-orb">
                    <span className="app-logo-euro">€</span>
                    <svg className="app-logo-chart" viewBox="0 0 48 24" fill="none">
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
                  <h1 className="app-title">{t.title}</h1>
                  <p className="app-subtitle">{t.subtitle}</p>
                </div>
              </div>

              <div className="app-actions">
                <button
                  type="button"
                  className="app-toggle-pill"
                  onClick={() => setLang(lang === "pl" ? "en" : "pl")}
                  aria-label={lang === "pl" ? "Zmień język" : "Change language"}
                >
                  <Languages size={13} />
                  <span>{lang === "pl" ? "PL" : "EN"}</span>
                </button>

                <button
                  type="button"
                  className="app-toggle-pill"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={lang === "pl" ? "Zmień motyw" : "Change theme"}
                >
                  {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                  <span>{theme === "dark" ? "Dark" : "Light"}</span>
                </button>
              </div>
            </div>

            <div className="app-tabs-wrap">
              <TabsList className="app-tabs-list">
                {tabs.map((tab) => {
                  const Icon = tab.icon;

                  return (
                    <TabsTrigger key={tab.value} value={tab.value} className="app-tab">
                      <Icon className="h-4 w-4" />
                      <span>{t.tabs[tab.key]}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
        </header>

        <main className="app-main">
          <TabsContent value="summary" className="app-tab-content">
            <DashboardTab lang={lang} />
          </TabsContent>

          <TabsContent value="data" className="app-tab-content">
            <DataTab lang={lang} />
          </TabsContent>

          <TabsContent value="forecast" className="app-tab-content">
            <ForecastTab lang={lang} />
          </TabsContent>

          <TabsContent value="eval" className="app-tab-content">
            <ChartsTab lang={lang} />
          </TabsContent>

          <TabsContent value="errors" className="app-tab-content">
            <ModelErrorsTab lang={lang} />
          </TabsContent>

          <TabsContent value="models" className="app-tab-content">
            <ModelsTab lang={lang} />
          </TabsContent>

          <TabsContent value="logs" className="app-tab-content">
            <LogsTab lang={lang} />
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}
