# 💶 EUR/PLN Tracker — Forecasting Dashboard (FastAPI + React)  

An **end-to-end EUR/PLN forecasting app**: fetch data from the **NBP API** → feature engineering → train ML models → display **metrics, forecasts, charts, and logs** in a clean dashboard.  

🌐 **Live:** https://Avuii.github.io/EUR-PLN-Tracker/    
⚠️ Educational project — **not financial advice**.  

---

## ✨ Features  
- Fetches **EUR/PLN** exchange-rate time series from **NBP API** 
- Trains and compares models:  
  - **Ridge Regression**  
  - **RandomForestRegressor**  
- Optional tuning (can run without tuning)  
- Metrics: **RMSE / MAE / MAPE**  
- Saves artifacts to `results/` (JSON/CSV)  
- Backend API + runtime logs powering the UI
  
---

## 🧱 Tech stack
- **Backend:** Python, FastAPI, scikit-learn, pandas, numpy, matplotlib
- **Frontend:** React + Vite

---

## 📁 Project structure

```
├── backend/
│ ├── main.py # FastAPI API
│ ├── fetch_nbp.py # NBP fetch -> CSV
│ ├── train_eval.py # train/eval + save artifacts to results/
│ └── requirements.txt
├── data/ # input data (e.g., eur_a.csv)
├── results/ # generated outputs (JSON/CSV/PNG)
├── src/ # frontend (React)
├── index.html
├── package.json
└── iconEuro.png
```


---

## ▶️ Run locally

### 1) Backend (FastAPI)
```bash
cd backend

python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```
Backend:  
Health: http://localhost:8000/api/health  
Swagger: http://localhost:8000/docs  

### 2) Frontend (React + Vite)
In another terminal (project root):  
```
npm install
npm run dev
```

---

## 🔧 Configuration
### API base URL (frontend)
When deployed to GitHub Pages, the frontend must call a public backend (FastAPI hosted elsewhere).  
  
Use a Vite env var, for example:  
```Local: VITE_API_BASE_URL=http://localhost:8000  ```
```Prod: VITE_API_BASE_URL=https://YOUR_BACKEND_DOMAIN  ```
   
Create .env.local (not committed):  
```VITE_API_BASE_URL=http://localhost:8000```  

In code:
```const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";  ```

---

## 🚀 Deployment (GitHub Pages via GitHub Actions)

This project uses GitHub Actions to build the Vite app and deploy it to GitHub Pages.  

### 1) Set Vite base path  
For project pages (https://YOUR_USERNAME.github.io/EUR-PLN-Tracker/) you must set:  
``` vite.config.ts
  
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/EUR-PLN-Tracker/", // <-- repo name
});


```
### 2) Add the GitHub Actions workflow

Create a file:
```
.github/workflows/deploy.yml

name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - name: Install
        run: npm ci

      - name: Build
        run: npm run build

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4


```

### 3) Enable Pages in repository settings

Go to:  
Settings → Pages  
Build and deployment → Source: GitHub Actions  
  
After pushing to main, the workflow will publish your site automatically.  

---
### 🧑‍💻 Author

Created by Avuii
