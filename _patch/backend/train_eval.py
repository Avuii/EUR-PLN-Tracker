import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

from sklearn.model_selection import TimeSeriesSplit, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error


# =========================
# ŚCIEŻKI
# =========================
THIS_DIR = Path(__file__).resolve().parent


def _find_project_root(start: Path) -> Path:
    """Pozwala odpalić skrypt zarówno z backend/, jak i z root."""
    for c in [start, start.parent, start.parent.parent]:
        if (c / "package.json").exists() or (c / "data").exists() or (c / "results").exists():
            return c
    return start.parent


ROOT = _find_project_root(THIS_DIR)
DATA_PATH = ROOT / "data" / "eur_a.csv"
OUT_DIR = ROOT / "results"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# =========================
# USTAWIENIA
# =========================
TEST_SIZE_SAMPLES = 260      # ~1 rok dni roboczych
ZOOM_WINDOW_DAYS = 90
DPI = 220

DO_TUNING = True
TS_SPLITS = 6
N_SEARCH_ITERS_RIDGE = 80
N_SEARCH_ITERS_RF = 180
RANDOM_STATE = 0

FORECAST_HORIZON_DAYS = 7    # do UI: tydzień w przód (dni robocze)


# =========================
# Feature engineering
# =========================
def make_features(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy().sort_values("date").reset_index(drop=True)
    d["value"] = d["value"].astype(float)

    # target jutro (poziom) i delta
    d["target_t1"] = d["value"].shift(-1)
    d["target_delta"] = d["target_t1"] - d["value"]

    # LAGI kursu (wszystko z przeszłości)
    for k in [1, 2, 3, 5, 10, 20]:
        d[f"lag_{k}"] = d["value"].shift(k)

    # log-return z dnia t (a nie t+1)
    d["logret_1"] = np.log(d["value"]).diff(1)

    # rollingi (tylko przeszłość => shift(1))
    d["roll_mean_5"] = d["value"].shift(1).rolling(5).mean()
    d["roll_mean_10"] = d["value"].shift(1).rolling(10).mean()
    d["roll_std_5"] = d["value"].shift(1).rolling(5).std()
    d["roll_std_10"] = d["value"].shift(1).rolling(10).std()
    d["vol_10"] = d["logret_1"].shift(1).rolling(10).std()

    # day-of-week
    d["dow"] = pd.to_datetime(d["date"]).dt.dayofweek

    # usuwamy NA (lagi/rolling + ostatni dzień bez targetu)
    d = d.dropna().reset_index(drop=True)
    return d


# =========================
# Metryki
# =========================
def mape(y_true, y_pred, eps=1e-9) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.maximum(np.abs(y_true), eps)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


def directional_accuracy(y_true_tomorrow, y_pred_tomorrow, today_value) -> float:
    true_move = np.sign(np.asarray(y_true_tomorrow) - np.asarray(today_value))
    pred_move = np.sign(np.asarray(y_pred_tomorrow) - np.asarray(today_value))
    return float(np.mean(true_move == pred_move))


def compute_metrics(y_true, y_pred, today_value, allow_dir=True) -> dict:
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(mean_squared_error(y_true, y_pred) ** 0.5)
    out = {"MAE": mae, "RMSE": rmse, "MAPE_pct": mape(y_true, y_pred)}
    out["dir_acc"] = directional_accuracy(y_true, y_pred, today_value) if allow_dir else None
    return out


# =========================
# Wykresy
# =========================
def plot_series(dates, y_true, preds: dict, title: str, out_path: Path, figsize=(20, 6)):
    plt.figure(figsize=figsize)
    plt.plot(dates, y_true, label="true", linewidth=2.2)

    for name, yhat in preds.items():
        plt.plot(dates, yhat, label=name, linewidth=1.6)

    ax = plt.gca()
    ax.set_title(title)
    ax.grid(True, alpha=0.25)
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.legend()
    plt.savefig(out_path, dpi=DPI)
    plt.close()


def plot_errors(dates, errors: dict, title: str, out_path: Path, figsize=(20, 5)):
    plt.figure(figsize=figsize)
    for name, err in errors.items():
        plt.plot(dates, err, label=name, linewidth=1.2)

    ax = plt.gca()
    ax.set_title(title)
    ax.axhline(0, linewidth=1)
    ax.grid(True, alpha=0.25)
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.legend()
    plt.savefig(out_path, dpi=DPI)
    plt.close()


# =========================
# Forecast na kolejne dni robocze
# =========================
def next_business_days(start_date: pd.Timestamp, n: int) -> list[pd.Timestamp]:
    days = []
    cur = start_date
    while len(days) < n:
        cur = cur + pd.Timedelta(days=1)
        if cur.dayofweek < 5:  # Mon-Fri
            days.append(cur)
    return days


def fmt(x: float) -> str:
    return f"{x:.4f}"


def arrow(delta: float) -> str:
    return "↑" if delta > 0 else ("↓" if delta < 0 else "→")


# =========================
# MAIN
# =========================
def main():
    global TEST_SIZE_SAMPLES, ZOOM_WINDOW_DAYS

    ap = argparse.ArgumentParser()
    ap.add_argument("--no-tuning", action="store_true")

    # parametry pod backend/API
    ap.add_argument("--test-size-samples", type=int, default=TEST_SIZE_SAMPLES)
    ap.add_argument("--zoom-window-days", type=int, default=ZOOM_WINDOW_DAYS)
    ap.add_argument("--forecast-days-7", type=int, default=FORECAST_HORIZON_DAYS)
    ap.add_argument("--forecast-days-1m", type=int, default=22)   # ~1 miesiąc dni roboczych
    ap.add_argument("--forecast-days-12m", type=int, default=260) # ~1 rok dni roboczych

    args = ap.parse_args()

    TEST_SIZE_SAMPLES = int(args.test_size_samples)
    ZOOM_WINDOW_DAYS = int(args.zoom_window_days)

    forecast_days_7 = int(args.forecast_days_7)
    forecast_days_1m = int(args.forecast_days_1m)
    forecast_days_12m = int(args.forecast_days_12m)

    do_tuning = DO_TUNING and (not args.no_tuning)

    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Brak pliku danych: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
    feat = make_features(df)

    # cechy (BEZ date i targetów)
    drop_cols = {"date", "target_t1", "target_delta"}
    feature_cols = [c for c in feat.columns if c not in drop_cols]

    X_all = feat[feature_cols].values
    y_delta_all = feat["target_delta"].values  # uczymy deltę
    dates_all = feat["date"].values
    today_all = feat["value"].values
    true_tomorrow_all = feat["target_t1"].values

    if TEST_SIZE_SAMPLES >= len(feat) - 50:
        raise ValueError("TEST_SIZE_SAMPLES za duże względem liczby próbek.")

    split = len(feat) - TEST_SIZE_SAMPLES
    X_train, X_test = X_all[:split], X_all[split:]
    y_train, y_test_delta = y_delta_all[:split], y_delta_all[split:]
    dates_test = dates_all[split:]
    today_test = today_all[split:]
    true_tomorrow_test = true_tomorrow_all[split:]

    # =========================
    # BASELINES (poziom jutro)
    # =========================
    pred_base = today_test
    pred_ma5 = feat["roll_mean_5"].iloc[split:].values
    # momentum: dziś + (dziś - wczoraj)
    yesterday_test = feat["lag_1"].iloc[split:].values
    pred_mom = today_test + (today_test - yesterday_test)

    # =========================
    # MODELE (delta)
    # =========================
    ridge_pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("model", Ridge(random_state=RANDOM_STATE))
    ])

    rf = RandomForestRegressor(
        random_state=RANDOM_STATE,
        n_jobs=-1
    )

    tscv = TimeSeriesSplit(n_splits=TS_SPLITS)

    ridge_best_params = {"model__alpha": 1.0}
    rf_best_params = {
        "n_estimators": 1200,
        "max_depth": 10,
        "min_samples_leaf": 5,
        "min_samples_split": 10,
        "max_features": "sqrt",
    }

    if do_tuning:
        ridge_param_dist = {"model__alpha": np.logspace(-5, 4, 300)}
        ridge_search = RandomizedSearchCV(
            ridge_pipe,
            param_distributions=ridge_param_dist,
            n_iter=N_SEARCH_ITERS_RIDGE,
            cv=tscv,
            scoring="neg_mean_absolute_error",
            random_state=RANDOM_STATE,
            n_jobs=-1,
            verbose=0,
        )
        ridge_search.fit(X_train, y_train)
        ridge_pipe = ridge_search.best_estimator_
        ridge_best_params = ridge_search.best_params_

        rf_param_dist = {
            "n_estimators": [800, 1200, 1800, 2600],
            "max_depth": [6, 8, 10, 12, 16, None],
            "min_samples_leaf": [1, 2, 3, 5, 8],
            "min_samples_split": [2, 5, 10, 20],
            "max_features": ["sqrt", "log2", 0.5, 1.0],
        }
        rf_search = RandomizedSearchCV(
            rf,
            param_distributions=rf_param_dist,
            n_iter=N_SEARCH_ITERS_RF,
            cv=tscv,
            scoring="neg_root_mean_squared_error",
            random_state=RANDOM_STATE,
            n_jobs=-1,
            verbose=1,
        )
        rf_search.fit(X_train, y_train)
        rf = rf_search.best_estimator_
        rf_best_params = rf_search.best_params_

    ridge_pipe.fit(X_train, y_train)
    rf.fit(X_train, y_train)

    pred_delta_ridge = ridge_pipe.predict(X_test)
    pred_delta_rf = rf.predict(X_test)

    pred_ridge = today_test + pred_delta_ridge
    pred_rf = today_test + pred_delta_rf

    # =========================
    # METRYKI
    # =========================
    metrics = {
        "dataset": str(DATA_PATH),
        "n_rows_used": int(len(feat)),
        "test_size_samples": int(TEST_SIZE_SAMPLES),
        "features": feature_cols,
        "baseline_persistence": compute_metrics(true_tomorrow_test, pred_base, today_test, allow_dir=False),
        "baseline_ma5": compute_metrics(true_tomorrow_test, pred_ma5, today_test, allow_dir=True),
        "baseline_momentum": compute_metrics(true_tomorrow_test, pred_mom, today_test, allow_dir=True),
        "ridge_delta": compute_metrics(true_tomorrow_test, pred_ridge, today_test, allow_dir=True),
        "random_forest_delta": compute_metrics(true_tomorrow_test, pred_rf, today_test, allow_dir=True),
        "ridge_best_params": ridge_best_params,
        "rf_best_params": rf_best_params,
        "tuning": {
            "enabled": bool(do_tuning),
            "ts_splits": int(TS_SPLITS),
            "ridge_iters": int(N_SEARCH_ITERS_RIDGE),
            "rf_iters": int(N_SEARCH_ITERS_RF),
        },
    }

    # =========================
    # FORECAST: t_last -> t_last+1 (jedna prognoza)
    # =========================
    x_last = feat[feature_cols].iloc[-1].values.reshape(1, -1)
    date_last = pd.to_datetime(feat["date"].iloc[-1]).date()
    value_today = float(feat["value"].iloc[-1])

    pred_base_next = value_today
    pred_delta_ridge_next = float(ridge_pipe.predict(x_last)[0])
    pred_delta_rf_next = float(rf.predict(x_last)[0])

    pred_ridge_next = value_today + pred_delta_ridge_next
    pred_rf_next = value_today + pred_delta_rf_next

    metrics["next_day_forecast"] = {
        "last_date": str(date_last),
        "today_value": value_today,
        "baseline": pred_base_next,
        "ridge_delta": pred_ridge_next,
        "rf_delta": pred_rf_next,
    }

    with open(OUT_DIR / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    # =========================
    # TABELA TEST: dzisiaj + jutro true + pred
    # =========================
    pred_df = pd.DataFrame({
        "date": pd.to_datetime(dates_test),
        "today_value": today_test,
        "true_tomorrow": true_tomorrow_test,
        "pred_baseline": pred_base,
        "pred_ma5": pred_ma5,
        "pred_momentum": pred_mom,
        "pred_ridge": pred_ridge,
        "pred_rf": pred_rf,
    })

    for col in ["pred_baseline", "pred_ma5", "pred_momentum", "pred_ridge", "pred_rf"]:
        pred_df[f"err_{col}"] = pred_df[col] - pred_df["true_tomorrow"]
        pred_df[f"abs_err_{col}"] = np.abs(pred_df[f"err_{col}"])

    pred_df.to_csv(OUT_DIR / "predictions_test.csv", index=False)

    # =========================
    # Forecasty (recursive forecast) — 7 dni / 1 miesiąc / 12 miesięcy
    # Uwaga: to jest rekurencyjne doklejanie predykcji do historii.
    # =========================
    history_values = list(feat["value"].astype(float).values)

    def build_row_from_history(dt: pd.Timestamp, hist: list[float]) -> dict:
        v = np.array(hist, dtype=float)
        cur = v[-1]
        row = {"date": dt, "value": cur}

        for k in [1, 2, 3, 5, 10, 20]:
            row[f"lag_{k}"] = v[-k] if len(v) > k else np.nan

        logv = np.log(v)
        row["logret_1"] = (logv[-1] - logv[-2]) if len(v) > 1 else np.nan

        s = pd.Series(v)
        row["roll_mean_5"] = s.shift(1).rolling(5).mean().iloc[-1]
        row["roll_mean_10"] = s.shift(1).rolling(10).mean().iloc[-1]
        row["roll_std_5"] = s.shift(1).rolling(5).std().iloc[-1]
        row["roll_std_10"] = s.shift(1).rolling(10).std().iloc[-1]
        lr = pd.Series(np.log(v)).diff(1)
        row["vol_10"] = lr.shift(1).rolling(10).std().iloc[-1]

        row["dow"] = dt.dayofweek
        return row

    def run_recursive_forecast(n_days: int, out_csv: Path) -> None:
        future_dates = next_business_days(pd.to_datetime(feat["date"].iloc[-1]), n_days)
        base_val = history_values[-1]

        forecast_rows = []
        hist_ridge = history_values.copy()
        hist_rf = history_values.copy()

        for dt in future_dates:
            fr = build_row_from_history(dt, hist_ridge)
            Xr = pd.DataFrame([fr])[feature_cols].values
            d_r = float(ridge_pipe.predict(Xr)[0])
            next_r = float(hist_ridge[-1] + d_r)
            hist_ridge.append(next_r)

            ff = build_row_from_history(dt, hist_rf)
            Xf = pd.DataFrame([ff])[feature_cols].values
            d_f = float(rf.predict(Xf)[0])
            next_f = float(hist_rf[-1] + d_f)
            hist_rf.append(next_f)

            forecast_rows.append({
                "date": dt.date().isoformat(),
                "baseline": base_val,
                "ridge": next_r,
                "rf": next_f,
            })

        pd.DataFrame(forecast_rows).to_csv(out_csv, index=False)

    run_recursive_forecast(forecast_days_7, OUT_DIR / "forecast_next7.csv")
    run_recursive_forecast(forecast_days_1m, OUT_DIR / "forecast_next1m.csv")
    run_recursive_forecast(forecast_days_12m, OUT_DIR / "forecast_next12m.csv")

    # =========================
    # WYKRESY
    # =========================
    plot_series(
        pred_df["date"].values,
        pred_df["true_tomorrow"].values,
        preds={
            "baseline": pred_df["pred_baseline"].values,
            "ma5": pred_df["pred_ma5"].values,
            "momentum": pred_df["pred_momentum"].values,
            "ridge(delta)": pred_df["pred_ridge"].values,
            "rf(delta)": pred_df["pred_rf"].values,
        },
        title=f"EUR t+1 — predykcje na teście (ostatnie {TEST_SIZE_SAMPLES} próbek)",
        out_path=OUT_DIR / "pred_test_full.png",
        figsize=(20, 6),
    )

    last_date = pred_df["date"].max()
    zoom_start = last_date - pd.Timedelta(days=ZOOM_WINDOW_DAYS)
    zoom_df = pred_df[pred_df["date"] >= zoom_start].copy()

    plot_series(
        zoom_df["date"].values,
        zoom_df["true_tomorrow"].values,
        preds={
            "baseline": zoom_df["pred_baseline"].values,
            "ma5": zoom_df["pred_ma5"].values,
            "momentum": zoom_df["pred_momentum"].values,
            "ridge(delta)": zoom_df["pred_ridge"].values,
            "rf(delta)": zoom_df["pred_rf"].values,
        },
        title=f"EUR t+1 — zoom ostatnich {ZOOM_WINDOW_DAYS} dni",
        out_path=OUT_DIR / "pred_test_zoom.png",
        figsize=(20, 6),
    )

    plot_errors(
        pred_df["date"].values,
        errors={
            "baseline": pred_df["err_pred_baseline"].values,
            "ma5": pred_df["err_pred_ma5"].values,
            "momentum": pred_df["err_pred_momentum"].values,
            "ridge(delta)": pred_df["err_pred_ridge"].values,
            "rf(delta)": pred_df["err_pred_rf"].values,
        },
        title="EUR t+1 — błąd predykcji (pred - true) na teście",
        out_path=OUT_DIR / "errors_test.png",
        figsize=(20, 5),
    )

    forecast_out = {
        "next_day_forecast": {
            "last_date": str(date_last),
            "today_value": float(value_today),
            "baseline": float(pred_base_next),
            "ridge_delta": float(pred_delta_ridge_next),
            "rf_delta": float(pred_delta_rf_next),
        }
    }
    with open(OUT_DIR / "forecast.json", "w", encoding="utf-8") as f:
        json.dump(forecast_out, f, indent=2, ensure_ascii=False)

    # =========================
    # KRÓTKI OUTPUT W KONSOLI
    # =========================
    print("\n=== EUR/PLN — prognoza t+1 (na podstawie ostatniego dostępnego dnia) ===")
    print(f"Dzień t (ostatnia obserwacja): {date_last}")
    print(f"Kurs dziś: {fmt(value_today)} PLN")

    def one_line(name, pred):
        d = pred - value_today
        grosze = d * 100.0
        print(f"{name:>14}: {fmt(pred)} PLN  ({arrow(d)} {grosze:+.1f} gr)")

    one_line("baseline", pred_base_next)
    one_line("ridge(delta)", pred_ridge_next)
    one_line("rf(delta)", pred_rf_next)

    print("\nZapisano pliki:")
    print(f"- {OUT_DIR / 'metrics.json'}")
    print(f"- {OUT_DIR / 'predictions_test.csv'}")
    print(f"- {OUT_DIR / 'forecast_next7.csv'}")
    print(f"- {OUT_DIR / 'forecast_next1m.csv'}")
    print(f"- {OUT_DIR / 'forecast_next12m.csv'}")
    print(f"- {OUT_DIR / 'pred_test_full.png'}")
    print(f"- {OUT_DIR / 'pred_test_zoom.png'}")
    print(f"- {OUT_DIR / 'errors_test.png'}")


if __name__ == "__main__":
    main()
