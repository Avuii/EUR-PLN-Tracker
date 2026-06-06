# 💶 EUR/PLN Tracker

<p align="center">
  <strong>End-to-end forecasting dashboard for EUR/PLN exchange rates.</strong><br />
  Fetch NBP data, train multiple models, compare errors and view forecasts in a premium React dashboard.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-Backend-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-API-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/React-Frontend-61DAFB?style=for-the-badge&logo=react&logoColor=111827" />
  <img src="https://img.shields.io/badge/TypeScript-UI-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-Build-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/ML-Forecasting-22C55E?style=for-the-badge" />
</p>

<p align="center">
  <img src="screenshots/Summary.png" alt="EUR/PLN Tracker dashboard dark mode" width="820" />
</p>

---

## ✨ What is this?

**EUR/PLN Tracker** is a web application for forecasting the EUR/PLN exchange rate.

The app downloads historical exchange rates from the **NBP API**, builds time-series datasets, trains multiple forecasting models and presents everything in a clean dashboard with charts, metrics, logs and error analysis.

It is built as a full-stack project:

- **Python + FastAPI backend** for data fetching, ML training and API endpoints,
- **React + TypeScript frontend** for interactive charts and dashboard views,
- **dark/light theme** and **PL/EN language switcher**.

---

## 🚀 Key Features

### 💱 Data pipeline

- Fetches EUR/PLN exchange rates from NBP.
- Supports incremental updates.
- Handles missing newest NBP dates gracefully.
- Saves raw data, datasets, predictions, metrics and logs.
- Creates repeatable run folders for experiments.

### 🧠 Forecasting models

The backend can train and compare multiple models:

| Type | Models |
|---|---|
| Baselines | Naive, SMA, EMA |
| Linear models | Ridge, ElasticNet |
| Tree ensembles | RandomForest, ExtraTrees |
| Boosting | HistGradientBoosting, XGBoost, LightGBM |
| Time series | SARIMAX |
| Neural network | MLPRegressor |

### 📆 Forecast horizons

The app supports several business-day horizons:

```text
H=1, H=7, H=30, H=90, H=180, H=365
```

Each horizon can use its own lookback window and is evaluated separately.

### 📊 Evaluation

The pipeline calculates:

- MAE,
- RMSE,
- MAPE,
- SMAPE,
- bias,
- direction accuracy.

The frontend shows true vs predicted values, residuals, model comparison and the best model selected for each horizon.

### 🎨 Dashboard UI

- Premium glassmorphism interface.
- Dark and light mode.
- PL/EN language switcher.
- Interactive Recharts charts.
- Forecast view by horizon and model.
- Model cards with metrics and raw parameters.
- Backend logs directly in the browser.

---

## 📸 Screenshots

### Summary

| Dark mode | Light mode |
|---|---|
| <img src="screenshots/Summary.png" alt="Summary dark mode" width="420" /> | <img src="screenshots/Summarylight.png" alt="Summary light mode" width="420" /> |

### Forecasts

| Forecasts | Forecasts light mode |
|---|---|
| <img src="screenshots/forecasts.png" alt="Forecasts dark mode" width="420" /> | <img src="screenshots/forecastslight.png" alt="Forecasts light mode" width="420" /> |

### Data

| Data table | Recent records | Light mode |
|---|---|---|
| <img src="screenshots/data.png" alt="Data view" width="300" /> | <img src="screenshots/data2.png" alt="Recent records" width="300" /> | <img src="screenshots/datalight.png" alt="Data light mode" width="300" /> |

### Evaluation and error analysis

| Evaluation | Evaluation details | Error analysis |
|---|---|---|
| <img src="screenshots/evaluation.png" alt="Evaluation view" width="300" /> | <img src="screenshots/evaluation2.png" alt="Evaluation details" width="300" /> | <img src="screenshots/erroranalys.png" alt="Error analysis" width="300" /> |

### Models

| Dark mode | Details | Light mode |
|---|---|---|
| <img src="screenshots/models.png" alt="Models dark mode" width="300" /> | <img src="screenshots/modele1.png" alt="Model details" width="300" /> | <img src="screenshots/modelslight.png" alt="Models light mode" width="300" /> |

### Logs

| Logs dark mode | Logs light mode |
|---|---|
| <img src="screenshots/logs.png" alt="Logs dark mode" width="420" /> | <img src="screenshots/logi2.png" alt="Logs light mode" width="420" /> |

---

## 🧪 Machine Learning Pipeline

The backend workflow is split into small scripts:

| Step | File | Description |
|---|---|---|
| Fetch data | `fetch_nbp.py` | Downloads EUR/PLN exchange rates from NBP. |
| Build dataset | `build_dataset.py` | Creates lag, rolling, EMA and calendar features. |
| Train and evaluate | `train_eval.py` | Trains models, evaluates them and saves predictions. |
| Run experiment | `run_experiment.py` | Runs the full pipeline. |
| API | `api.py` | Exposes data, forecasts, metrics, logs and artifacts to the frontend. |

### Generated artifacts

Each run can create files such as:

```text
config.json
pipeline.log
pipeline_status.json
run_config.json
metrics.json
metrics.csv
forecast_points.csv
predictions_H1.csv
predictions_H7.csv
predictions_H30.csv
predictions_H90.csv
predictions_H180.csv
predictions_H365.csv
backtest.json
best_ml_params.json
summary.json
```

---

## 🛠️ Tech Stack

| Area | Technology |
|---|---|
| Backend | Python |
| API | FastAPI |
| Data processing | pandas, NumPy |
| Machine learning | scikit-learn |
| Time series | SARIMAX |
| Optional ML libraries | XGBoost, LightGBM |
| Frontend | React |
| Language | TypeScript |
| Build tool | Vite |
| Charts | Recharts |
| Icons | Lucide React |
| Styling | Tailwind CSS, custom CSS |
| Data source | NBP API |

---

## ⚙️ Requirements

- Python 3.10+
- Node.js 18+
- npm
- Git
- modern browser

Recommended:

- Visual Studio Code
- Windows Terminal or PowerShell

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Avuii/EUR-PLN-Tracker.git
cd EUR-PLN-Tracker
```

### 2. Install backend dependencies

```bash
cd backend
py -m pip install -r requirements.txt
```

### 3. Run the ML pipeline

Fast run without hyperparameter tuning:

```bash
py -m src.run_experiment --config configs/config.json --no-tuning
```

Full run:

```bash
py -m src.run_experiment --config configs/config.json
```

Generated results are saved in:

```text
backend/runs/
```

### 4. Start the backend API

```bash
py -m uvicorn api.api:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```text
http://127.0.0.1:8000/api/health
```

### 5. Start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://127.0.0.1:4000
```

---

## 🔌 API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/health` | Backend health check. |
| `GET /api/results` | Main dashboard results. |
| `GET /api/series?days=3650` | Historical EUR/PLN series. |
| `GET /api/data?limit=500` | Historical data table. |
| `GET /api/predictions?h=30` | Predictions for selected horizon. |
| `GET /api/forecast?h=30` | Forecast point for selected horizon. |
| `GET /api/logs` | Latest pipeline logs. |
| `GET /api/runs` | List of pipeline runs. |
| `POST /api/run` | Run the pipeline from the frontend. |
| `GET /api/export/data.xlsx` | Export historical data to XLSX. |

---

## 📁 Project Structure

```text
EUR-PLN-Tracker/
├── backend/
│   ├── api/
│   │   ├── __init__.py
│   │   └── api.py
│   ├── configs/
│   │   └── config.json
│   ├── data/
│   ├── runs/
│   │   └── YYYY-MM-DD_HHMMSS/
│   ├── src/
│   │   ├── build_dataset.py
│   │   ├── config.py
│   │   ├── fetch_nbp.py
│   │   ├── run_experiment.py
│   │   └── train_eval.py
│   └── requirements.txt
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   └── App.tsx
│   │   ├── styles/
│   │   │   ├── index.css
│   │   │   ├── tailwind.css
│   │   │   └── theme.css
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
│
├── screenshots/
├── .gitignore
└── README.md
```

---

## 🧩 Configuration

Main configuration file:

```text
backend/configs/config.json
```

You can configure:

- currency pair,
- date range,
- forecast horizons,
- lookback windows,
- train/validation/test split,
- enabled models,
- tuning settings,
- backtest settings,
- output directories.

---

## 📝 Notes
- The frontend uses Vite proxy for `/api` requests to the local FastAPI backend.
- The newest NBP quotation may be unavailable on weekends, holidays or before publication time. The pipeline can keep using the latest available data.

---

## 👩‍💻 Author

Created by **Katarzyna Stańczyk**.
