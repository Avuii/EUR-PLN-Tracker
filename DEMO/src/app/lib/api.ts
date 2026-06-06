import {
  getMockData,
  getMockForecast,
  getMockPredictions,
  getMockSeries,
  mockLogs,
  mockResults,
} from "./mockData";

export const API_URL = "";

export type ResultsResponse = typeof mockResults;

export type ForecastRow = Record<string, any> & {
  date?: string;
  baseline?: number | null;
  best_value?: number | null;
};

export type PredictionsTestRow = Record<string, any> & {
  date: string;
  target_date?: string;
  y_t?: number | null;
  true_tomorrow?: number | null;
  true_target?: number | null;
  pred_best?: number | null;
};

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function wait(ms = 160) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const api = {
  async health() {
    await wait(60);
    return { ok: true, pair: "EUR/PLN", mode: "demo" };
  },

  async results(): Promise<ResultsResponse> {
    await wait();
    return mockResults;
  },

  async series(days = 3650): Promise<{ series: Array<{ date: string; value: number }> }> {
    await wait();
    return { series: getMockSeries(days) };
  },

  async data(limit = 500): Promise<{ rows: Array<{ date: string; value: number }> }> {
    await wait();
    return { rows: getMockData(limit) };
  },

  async logs(offset = 0) {
    await wait(90);
    const text = mockLogs.slice(offset);

    return {
      text,
      logs: text,
      nextOffset: offset + text.length,
      state: {
        running: false,
        stage: null,
        error: null,
        startedAt: "2026-06-06T15:42:00Z",
        finishedAt: "2026-06-06T15:42:06Z",
      },
    };
  },

  async run() {
    await wait(650);

    return {
      ok: true,
      demo: true,
      message: "Demo mode: backend pipeline is disabled on GitHub Pages.",
      stdout: mockLogs,
      stderr: "",
      runDir: mockResults.runDir,
      results: mockResults,
    };
  },

  async forecast(h = 30): Promise<ForecastRow[]> {
    await wait();
    return getMockForecast(h);
  },

  async predictions(h = 30, limit?: number): Promise<PredictionsTestRow[]> {
    await wait();
    return getMockPredictions(h, limit);
  },

  async predictionsTest(limit = 260, h = 30): Promise<PredictionsTestRow[]> {
    return this.predictions(h, limit);
  },

  async errorsTest(modelKey = "pred_best", limit = 260, h = 30) {
    const rows = await this.predictions(h, limit);

    return rows.map((row) => {
      const y = num(row.true_target ?? row.true_tomorrow);
      const pred = num(row[modelKey]);
      const error = y !== null && pred !== null ? pred - y : null;

      return {
        date: row.target_date ?? row.date,
        true_tomorrow: y,
        pred,
        error,
        abs_error: error === null ? null : Math.abs(error),
      };
    });
  },
};
