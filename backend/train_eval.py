from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# =========================
# Paths
# =========================
THIS_DIR = Path(__file__).resolve().parent


def _find_project_root(start: Path) -> Path:
    for c in [start, start.parent, start.parent.parent]:
        if (c / "data").exists() or (c / "results").exists() or (c / "package.json").exists():
            return c
    return start.parent


ROOT = _find_project_root(THIS_DIR)
DATA_PATH_DEFAULT = ROOT / "data" / "eur_a.csv"
OUT_DIR = ROOT / "results"
OUT_DIR.mkdir(parents=True, exist_ok=True)

RANDOM_STATE = 0
log = logging.getLogger("train")

# =========================
# Logging
# =========================
def setup_logging(level: str) -> None:
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )

# =========================
# Feature engineering
# =========================
LAGS = [1, 2, 3, 5, 10, 20]


def make_features(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy().sort_values("date").reset_index(drop=True)
    d["date"] = pd.to_datetime(d["date"])
    d["value"] = d["value"].astype(float)

    # target: tomorrow level and delta (t+1 - t)
    d["target_t1"] = d["value"].shift(-1)
    d["target_delta"] = d["target_t1"] - d["value"]

    for k in LAGS:
        d[f"lag_{k}"] = d["value"].shift(k)

    d["logret_1"] = np.log(d["value"]).diff(1)

    # roll only from past => shift(1)
    d["roll_mean_5"] = d["value"].shift(1).rolling(5).mean()
    d["roll_mean_10"] = d["value"].shift(1).rolling(10).mean()
    d["roll_std_5"] = d["value"].shift(1).rolling(5).std()
    d["roll_std_10"] = d["value"].shift(1).rolling(10).std()
    d["vol_10"] = d["logret_1"].shift(1).rolling(10).std()

    d["dow"] = d["date"].dt.dayofweek.astype(int)

    d = d.dropna().reset_index(drop=True)
    return d


# =========================
# Metrics
# =========================
def mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denom = np.where(y_true == 0, 1.0, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


def smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denom = (np.abs(y_true) + np.abs(y_pred))
    denom = np.where(denom == 0, 1.0, denom)
    return float(np.mean(2.0 * np.abs(y_pred - y_true) / denom) * 100.0)


def direction_accuracy(today: np.ndarray, y_true_t1: np.ndarray, y_pred_t1: np.ndarray) -> float:
    true_delta = y_true_t1 - today
    pred_delta = y_pred_t1 - today
    return float(np.mean(np.sign(true_delta) == np.sign(pred_delta)))


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, today: np.ndarray) -> Dict[str, Any]:
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    return {
        "mae": mae,
        "rmse": rmse,
        "mape_pct": mape(y_true, y_pred),
        "smape_pct": smape(y_true, y_pred),
        "bias": float(np.mean(y_pred - y_true)),
        "dir_acc": direction_accuracy(today, y_true, y_pred),
    }


# =========================
# Split TS: train/val/test
# =========================
def split_train_val_test(n: int, test_size: int, val_size: int) -> Tuple[slice, slice, slice]:
    if test_size >= n - 50:
        raise ValueError("test_size_samples is too large for dataset length.")
    val_size = max(0, int(val_size))
    if val_size > 0 and (test_size + val_size) >= n - 50:
        # keep at least 50 samples for train
        val_size = max(0, n - test_size - 50)

    train_end = n - (val_size + test_size)
    val_end = n - test_size
    if train_end < 50:
        raise ValueError("Too few samples for train after split.")
    if val_size == 0:
        return slice(0, train_end), slice(train_end, train_end), slice(train_end, n)
    return slice(0, train_end), slice(train_end, val_end), slice(val_end, n)


# =========================
# Forecast helpers (business days)
# =========================
def next_business_days(start_date: pd.Timestamp, n: int) -> List[pd.Timestamp]:
    days: List[pd.Timestamp] = []
    cur = pd.to_datetime(start_date)
    while len(days) < n:
        cur = cur + pd.Timedelta(days=1)
        if cur.dayofweek < 5:
            days.append(cur)
    return days


def build_row_from_history(dt: pd.Timestamp, hist: List[float]) -> Dict[str, Any]:
    v = np.array(hist, dtype=float)
    cur = float(v[-1])
    row: Dict[str, Any] = {"date": dt, "value": cur}
    for k in LAGS:
        row[f"lag_{k}"] = float(v[-k]) if len(v) > k else np.nan

    logv = np.log(v)
    row["logret_1"] = float(logv[-1] - logv[-2]) if len(v) > 1 else np.nan

    s = pd.Series(v)
    row["roll_mean_5"] = float(s.shift(1).rolling(5).mean().iloc[-1])
    row["roll_mean_10"] = float(s.shift(1).rolling(10).mean().iloc[-1])
    row["roll_std_5"] = float(s.shift(1).rolling(5).std().iloc[-1])
    row["roll_std_10"] = float(s.shift(1).rolling(10).std().iloc[-1])

    lr = pd.Series(np.log(v)).diff(1)
    row["vol_10"] = float(lr.shift(1).rolling(10).std().iloc[-1])

    row["dow"] = int(pd.to_datetime(dt).dayofweek)
    return row


def ensure_dir(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)


def save_json(path: Path, obj: Any) -> None:
    ensure_dir(path)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def _baseline_preds(today: np.ndarray, lag1: np.ndarray, ma5: np.ndarray) -> Dict[str, np.ndarray]:
    pred_persist = today
    pred_ma5 = ma5
    pred_mom = today + (today - lag1)
    return {
        "baseline_persistence": pred_persist,
        "baseline_ma5": pred_ma5,
        "baseline_momentum": pred_mom,
    }


def _tree_pred_intervals_delta(model, X: np.ndarray) -> Dict[str, np.ndarray]:
    """
    For RF/ExtraTrees: use per-tree predictions for simple uncertainty bands.
    Returns quantiles for delta predictions.
    """
    if not hasattr(model, "estimators_") or model.estimators_ is None:
        return {}
    preds = np.vstack([est.predict(X) for est in model.estimators_])  # [n_estimators, n_samples]
    return {
        "p10": np.quantile(preds, 0.10, axis=0),
        "p90": np.quantile(preds, 0.90, axis=0),
        "p025": np.quantile(preds, 0.025, axis=0),
        "p975": np.quantile(preds, 0.975, axis=0),
    }


# =========================
# Walk-forward backtest
# =========================
def walk_forward_backtest(
    model,
    X_all: np.ndarray,
    y_delta_all: np.ndarray,
    today_all: np.ndarray,
    true_t1_all: np.ndarray,
    start_idx: int,
    total_len: int,
    n_windows: int,
) -> Dict[str, Any]:
    n = len(X_all)
    start_idx = max(50, int(start_idx))
    total_len = int(min(total_len, n - start_idx))
    n_windows = int(max(3, n_windows))

    win_len = max(20, total_len // n_windows)
    windows = []

    cur = start_idx
    for w in range(n_windows):
        train_end = cur
        test_end = min(cur + win_len, n)
        if test_end - train_end < 10:
            break

        X_tr = X_all[:train_end]
        y_tr = y_delta_all[:train_end]

        X_te = X_all[train_end:test_end]
        today_te = today_all[train_end:test_end]
        true_te = true_t1_all[train_end:test_end]

        m = clone(model)
        m.fit(X_tr, y_tr)
        pred_level = today_te + m.predict(X_te)

        met = compute_metrics(true_te, pred_level, today_te)
        windows.append({
            "window": int(w + 1),
            "train_end_index": int(train_end),
            "test_start_index": int(train_end),
            "test_end_index": int(test_end),
            **met,
        })
        cur = test_end
        if cur >= start_idx + total_len:
            break

    out = {"n_windows": len(windows), "window_len": int(win_len), "windows": windows}
    if windows:
        out["mae_avg"] = float(np.mean([w["mae"] for w in windows]))
        out["rmse_avg"] = float(np.mean([w["rmse"] for w in windows]))
    else:
        out["mae_avg"] = float("nan")
        out["rmse_avg"] = float("nan")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()

    ap.add_argument("--data", type=str, default=str(DATA_PATH_DEFAULT))
    ap.add_argument("--log-level", type=str, default=os.getenv("LOG_LEVEL", "INFO"))

    ap.add_argument("--no-tuning", action="store_true")
    ap.add_argument("--test-size-samples", type=int, default=260)
    ap.add_argument("--val-size-samples", type=int, default=130)
    ap.add_argument("--zoom-window-days", type=int, default=90)

    # horizons are BUSINESS DAYS (to match NBP daily; 1m ~ 22, 12m ~ 260)
    ap.add_argument("--forecast-days-7", type=int, default=7)
    ap.add_argument("--forecast-days-30", type=int, default=22)
    ap.add_argument("--forecast-days-90", type=int, default=65)
    ap.add_argument("--forecast-days-180", type=int, default=130)
    ap.add_argument("--forecast-days-365", type=int, default=260)

    # backward-compatible aliases:
    ap.add_argument("--forecast-days-1m", type=int, default=None)
    ap.add_argument("--forecast-days-12m", type=int, default=None)

    ap.add_argument("--backtest-windows", type=int, default=5)

    args = ap.parse_args()
    setup_logging(args.log_level)

    t0 = time.perf_counter()
    data_path = Path(args.data)

    log.info(f"START train_eval | data={data_path} | no_tuning={args.no_tuning}")
    log.info("Note: horizons use BUSINESS DAYS (NBP daily).")

    if not data_path.exists():
        raise FileNotFoundError(f"Missing CSV: {data_path}")

    df = pd.read_csv(data_path, parse_dates=["date"]).sort_values("date").reset_index(drop=True)
    log.info(f"Loaded CSV rows={len(df)} range={df['date'].min().date()}..{df['date'].max().date()}")

    feat = make_features(df)
    log.info(f"Feature rows after dropna={len(feat)}")

    drop_cols = {"date", "target_t1", "target_delta"}
    feature_cols = [c for c in feat.columns if c not in drop_cols]

    X_all = feat[feature_cols].values
    y_delta_all = feat["target_delta"].values
    today_all = feat["value"].values
    true_t1_all = feat["target_t1"].values
    dates_all = pd.to_datetime(feat["date"]).values

    train_sl, val_sl, test_sl = split_train_val_test(len(feat), int(args.test_size_samples), int(args.val_size_samples))
    log.info(
        f"Split sizes | train={train_sl.stop-train_sl.start} | val={val_sl.stop-val_sl.start} | test={test_sl.stop-test_sl.start}"
    )

    X_train, y_train = X_all[train_sl], y_delta_all[train_sl]
    X_val, y_val = X_all[val_sl], y_delta_all[val_sl]
    X_test, y_test = X_all[test_sl], y_delta_all[test_sl]

    today_val = today_all[val_sl]
    today_test = today_all[test_sl]
    true_val = true_t1_all[val_sl]
    true_test = true_t1_all[test_sl]

    lag1_val = feat["lag_1"].iloc[val_sl].values if (val_sl.stop > val_sl.start) else np.array([])
    lag1_test = feat["lag_1"].iloc[test_sl].values
    ma5_val = feat["roll_mean_5"].iloc[val_sl].values if (val_sl.stop > val_sl.start) else np.array([])
    ma5_test = feat["roll_mean_5"].iloc[test_sl].values

    h7 = int(args.forecast_days_7)
    h30 = int(args.forecast_days_30 if args.forecast_days_30 is not None else 22)
    h90 = int(args.forecast_days_90)
    h180 = int(args.forecast_days_180)
    h365 = int(args.forecast_days_365)

    if args.forecast_days_1m is not None:
        h30 = int(args.forecast_days_1m)
    if args.forecast_days_12m is not None:
        h365 = int(args.forecast_days_12m)

    horizons = {"next7": h7, "next30": h30, "next90": h90, "next180": h180, "next365": h365}
    log.info(f"Horizons (business days): {horizons}")

    # =========================
    # Models (delta)
    # =========================
    ridge = Pipeline([("scaler", StandardScaler()), ("model", Ridge(random_state=RANDOM_STATE))])
    rf = RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1)
    et = ExtraTreesRegressor(random_state=RANDOM_STATE, n_jobs=-1)
    hgb = HistGradientBoostingRegressor(random_state=RANDOM_STATE)

    # strong defaults (fast)
    ridge.set_params(model__alpha=1.0)
    rf.set_params(n_estimators=1200, max_depth=10, min_samples_leaf=5, min_samples_split=10, max_features="sqrt")
    et.set_params(n_estimators=1200, max_depth=12, min_samples_leaf=2, min_samples_split=6, max_features="sqrt")
    hgb.set_params(max_depth=6, learning_rate=0.05, max_iter=600, max_leaf_nodes=31, min_samples_leaf=20)

    # tuning only on train (CV uses TimeSeriesSplit)
    if not args.no_tuning:
        log.info("Tuning enabled: RandomizedSearchCV with TimeSeriesSplit(5).")
        tscv = TimeSeriesSplit(n_splits=5)

        def _tune(name: str, estimator, params: Dict[str, Any], n_iter: int, scoring: str):
            log.info(f"[TUNE] {name} n_iter={n_iter} scoring={scoring}")
            t1 = time.perf_counter()
            rs = RandomizedSearchCV(
                estimator,
                param_distributions=params,
                n_iter=n_iter,
                cv=tscv,
                scoring=scoring,
                random_state=RANDOM_STATE,
                n_jobs=-1,
                verbose=0,
            )
            rs.fit(X_train, y_train)
            dt = time.perf_counter() - t1
            log.info(f"[TUNE] {name} done in {dt:.1f}s | best={rs.best_params_}")
            return rs.best_estimator_, rs.best_params_

        ridge, ridge_best = _tune(
            "ridge",
            ridge,
            {"model__alpha": np.logspace(-5, 4, 200)},
            n_iter=60,
            scoring="neg_mean_absolute_error",
        )
        rf, rf_best = _tune(
            "random_forest",
            rf,
            {
                "n_estimators": [600, 900, 1200, 1800],
                "max_depth": [6, 8, 10, 12, None],
                "min_samples_leaf": [1, 2, 3, 5, 8],
                "min_samples_split": [2, 5, 10, 20],
                "max_features": ["sqrt", "log2", 0.5, 1.0],
            },
            n_iter=70,
            scoring="neg_root_mean_squared_error",
        )
        et, et_best = _tune(
            "extra_trees",
            et,
            {
                "n_estimators": [600, 900, 1200, 1800],
                "max_depth": [6, 8, 10, 12, None],
                "min_samples_leaf": [1, 2, 3, 5, 8],
                "min_samples_split": [2, 5, 10, 20],
                "max_features": ["sqrt", "log2", 0.5, 1.0],
            },
            n_iter=70,
            scoring="neg_root_mean_squared_error",
        )
        hgb, hgb_best = _tune(
            "hist_gb",
            hgb,
            {
                "max_depth": [3, 4, 5, 6, 7, None],
                "learning_rate": [0.02, 0.03, 0.05, 0.08],
                "max_iter": [300, 500, 700, 900],
                "min_samples_leaf": [10, 20, 30, 50],
                "max_leaf_nodes": [15, 31, 63],
            },
            n_iter=60,
            scoring="neg_mean_absolute_error",
        )
    else:
        ridge_best = {}
        rf_best = {}
        et_best = {}
        hgb_best = {}
        log.info("Tuning disabled: using strong default hyperparameters.")

    # =========================
    # Validation (train->val) to pick best
    # =========================
    def _fit_predict_level(model, X_tr, y_tr, X_out, today_out) -> np.ndarray:
        m = clone(model)
        m.fit(X_tr, y_tr)
        return today_out + m.predict(X_out)

    pred_val = {}
    if len(X_val) > 0:
        log.info("Scoring on VAL (models fitted on TRAIN).")
        pred_val["ridge_delta"] = _fit_predict_level(ridge, X_train, y_train, X_val, today_val)
        pred_val["random_forest_delta"] = _fit_predict_level(rf, X_train, y_train, X_val, today_val)
        pred_val["extra_trees_delta"] = _fit_predict_level(et, X_train, y_train, X_val, today_val)
        pred_val["hist_gb_delta"] = _fit_predict_level(hgb, X_train, y_train, X_val, today_val)

        val_mae = {k: mean_absolute_error(true_val, v) for k, v in pred_val.items()}
        best_name = min(val_mae, key=val_mae.get)
        log.info(f"Best model by VAL MAE: {best_name} (mae={val_mae[best_name]:.6f})")
    else:
        best_name = "random_forest_delta"
        log.warning("VAL size=0 => skipping VAL selection. Default best=random_forest_delta.")

    # =========================
    # Final fit on TRAIN+VAL for TEST and FORECAST
    # =========================
    full_end = val_sl.stop if (val_sl.stop > val_sl.start) else train_sl.stop
    X_tr_full = X_all[:full_end]
    y_tr_full = y_delta_all[:full_end]
    log.info(f"Final fit on TRAIN+VAL samples={len(X_tr_full)}")

    ridge.fit(X_tr_full, y_tr_full)
    rf.fit(X_tr_full, y_tr_full)
    et.fit(X_tr_full, y_tr_full)
    hgb.fit(X_tr_full, y_tr_full)

    base_test = _baseline_preds(today_test, lag1_test, ma5_test)

    pred_test = {
        "ridge_delta": today_test + ridge.predict(X_test),
        "random_forest_delta": today_test + rf.predict(X_test),
        "extra_trees_delta": today_test + et.predict(X_test),
        "hist_gb_delta": today_test + hgb.predict(X_test),
    }

    # =========================
    # Save run_config.json (UI "uczciwość")
    # =========================
    split_cfg = {
        "train": {
            "start": str(pd.to_datetime(dates_all[train_sl.start]).date()),
            "end": str(pd.to_datetime(dates_all[train_sl.stop - 1]).date())
        },
        "val": None,
        "test": {
            "start": str(pd.to_datetime(dates_all[test_sl.start]).date()),
            "end": str(pd.to_datetime(dates_all[test_sl.stop - 1]).date())
        },
    }
    if val_sl.stop > val_sl.start:
        split_cfg["val"] = {
            "start": str(pd.to_datetime(dates_all[val_sl.start]).date()),
            "end": str(pd.to_datetime(dates_all[val_sl.stop - 1]).date())
        }

    run_config = {
        "pair": "EUR/PLN",
        "dataset_path": str(data_path),
        "date_start": str(pd.to_datetime(df["date"].min()).date()),
        "date_end": str(pd.to_datetime(df["date"].max()).date()),
        "target": "delta (t+1 - t), reconstructed to level(t+1)",
        "features": feature_cols,
        "feature_desc": f"lags={LAGS}, rolling mean/std, vol_10, day-of-week",
        "split": split_cfg,
        "sizes": {
            "n_train": int(train_sl.stop - train_sl.start),
            "n_val": int(val_sl.stop - val_sl.start),
            "n_test": int(test_sl.stop - test_sl.start),
        },
        "horizons_business_days": horizons,
        "tuning_enabled": bool(not args.no_tuning),
        "best_model_by_val_mae": best_name,
        "zoom_window_days": int(args.zoom_window_days),
        "seed": int(RANDOM_STATE),
    }
    save_json(OUT_DIR / "run_config.json", run_config)
    log.info("Saved results/run_config.json")

    # =========================
    # metrics.json
    # =========================
    metrics: Dict[str, Any] = {
        "best_model": {"name": best_name, "criterion": "val.mae" if (val_sl.stop > val_sl.start) else "default"},
        "params": {"ridge_best": ridge_best, "rf_best": rf_best, "et_best": et_best, "hgb_best": hgb_best},
        "models": {},
    }

    if val_sl.stop > val_sl.start:
        base_val = _baseline_preds(today_val, lag1_val, ma5_val)
        metrics["models"]["baseline_persistence"] = {"val": compute_metrics(true_val, base_val["baseline_persistence"], today_val)}
        metrics["models"]["baseline_ma5"] = {"val": compute_metrics(true_val, base_val["baseline_ma5"], today_val)}
        metrics["models"]["baseline_momentum"] = {"val": compute_metrics(true_val, base_val["baseline_momentum"], today_val)}
        for name, yhat in pred_val.items():
            metrics["models"].setdefault(name, {})
            metrics["models"][name]["val"] = compute_metrics(true_val, yhat, today_val)

    metrics["models"].setdefault("baseline_persistence", {})
    metrics["models"]["baseline_persistence"]["test"] = compute_metrics(true_test, base_test["baseline_persistence"], today_test)
    metrics["models"].setdefault("baseline_ma5", {})
    metrics["models"]["baseline_ma5"]["test"] = compute_metrics(true_test, base_test["baseline_ma5"], today_test)
    metrics["models"].setdefault("baseline_momentum", {})
    metrics["models"]["baseline_momentum"]["test"] = compute_metrics(true_test, base_test["baseline_momentum"], today_test)

    for name, yhat in pred_test.items():
        metrics["models"].setdefault(name, {})
        metrics["models"][name]["test"] = compute_metrics(true_test, yhat, today_test)

    save_json(OUT_DIR / "metrics.json", metrics)
    log.info("Saved results/metrics.json")

    # =========================
    # predictions_test.csv
    # =========================
    pred_df = pd.DataFrame({
        "date": pd.to_datetime(dates_all[test_sl]),
        "today_value": today_test,
        "true_tomorrow": true_test,
        "pred_baseline": base_test["baseline_persistence"],
        "pred_ma5": base_test["baseline_ma5"],
        "pred_momentum": base_test["baseline_momentum"],
        "pred_ridge": pred_test["ridge_delta"],
        "pred_rf": pred_test["random_forest_delta"],
        "pred_extra": pred_test["extra_trees_delta"],
        "pred_hgb": pred_test["hist_gb_delta"],
    })
    for col in [c for c in pred_df.columns if c.startswith("pred_")]:
        pred_df[f"err_{col}"] = pred_df[col] - pred_df["true_tomorrow"]
        pred_df[f"abs_err_{col}"] = np.abs(pred_df[f"err_{col}"])
    pred_df.to_csv(OUT_DIR / "predictions_test.csv", index=False)
    log.info("Saved results/predictions_test.csv")

    # =========================
    # backtest.json (walk-forward)
    # =========================
    start_backtest = full_end
    test_len = len(X_test)
    backtest = {
        "ridge_delta": walk_forward_backtest(ridge, X_all, y_delta_all, today_all, true_t1_all, start_backtest, test_len, int(args.backtest_windows)),
        "random_forest_delta": walk_forward_backtest(rf, X_all, y_delta_all, today_all, true_t1_all, start_backtest, test_len, int(args.backtest_windows)),
        "extra_trees_delta": walk_forward_backtest(et, X_all, y_delta_all, today_all, true_t1_all, start_backtest, test_len, int(args.backtest_windows)),
        "hist_gb_delta": walk_forward_backtest(hgb, X_all, y_delta_all, today_all, true_t1_all, start_backtest, test_len, int(args.backtest_windows)),
    }
    save_json(OUT_DIR / "backtest.json", backtest)
    log.info("Saved results/backtest.json")

    # =========================
    # Forecasts (recursive) + uncertainty for tree ensembles
    # =========================
    history_values = list(feat["value"].astype(float).values)
    last_dt = pd.to_datetime(feat["date"].iloc[-1])

    def forecast_one(n_days: int, out_csv: Path, alias_out_csv: Path | None = None) -> None:
        future_dates = next_business_days(last_dt, n_days)

        hist_ridge = history_values.copy()
        hist_rf = history_values.copy()
        hist_et = history_values.copy()
        hist_hgb = history_values.copy()

        best_model_obj = {"ridge_delta": ridge, "random_forest_delta": rf, "extra_trees_delta": et, "hist_gb_delta": hgb}.get(best_name, rf)

        rows = []
        for dt in future_dates:
            row_r = build_row_from_history(dt, hist_ridge)
            row_rf = build_row_from_history(dt, hist_rf)
            row_et = build_row_from_history(dt, hist_et)
            row_h = build_row_from_history(dt, hist_hgb)

            X_r = pd.DataFrame([row_r])[feature_cols].values
            X_rf = pd.DataFrame([row_rf])[feature_cols].values
            X_et = pd.DataFrame([row_et])[feature_cols].values
            X_h = pd.DataFrame([row_h])[feature_cols].values

            d_r = float(ridge.predict(X_r)[0])
            next_r = float(hist_ridge[-1] + d_r)
            hist_ridge.append(next_r)

            d_rf = float(rf.predict(X_rf)[0])
            next_rf = float(hist_rf[-1] + d_rf)
            hist_rf.append(next_rf)

            d_et = float(et.predict(X_et)[0])
            next_et = float(hist_et[-1] + d_et)
            hist_et.append(next_et)

            d_hgb = float(hgb.predict(X_h)[0])
            next_hgb = float(hist_hgb[-1] + d_hgb)
            hist_hgb.append(next_hgb)

            p80_low = p80_high = p95_low = p95_high = None
            if hasattr(best_model_obj, "estimators_"):
                if best_name == "random_forest_delta":
                    row_best, X_best = row_rf, X_rf
                elif best_name == "extra_trees_delta":
                    row_best, X_best = row_et, X_et
                else:
                    row_best, X_best = row_rf, X_rf

                q = _tree_pred_intervals_delta(best_model_obj, X_best)
                if q:
                    today_here = float(row_best["value"])
                    p80_low = float(today_here + q["p10"][0])
                    p80_high = float(today_here + q["p90"][0])
                    p95_low = float(today_here + q["p025"][0])
                    p95_high = float(today_here + q["p975"][0])

            rows.append({
                "date": dt.date().isoformat(),
                "baseline": float(history_values[-1]),
                "ridge": next_r,
                "rf": next_rf,
                "extra": next_et,
                "hgb": next_hgb,
                "best_model": best_name,
                "best_p80_low": p80_low,
                "best_p80_high": p80_high,
                "best_p95_low": p95_low,
                "best_p95_high": p95_high,
            })

        df_out = pd.DataFrame(rows)
        df_out.to_csv(out_csv, index=False)
        if alias_out_csv is not None:
            df_out.to_csv(alias_out_csv, index=False)

    log.info("Forecasting (recursive)...")
    forecast_one(h7, OUT_DIR / "forecast_next7.csv")
    forecast_one(h30, OUT_DIR / "forecast_next30.csv", alias_out_csv=OUT_DIR / "forecast_next1m.csv")
    forecast_one(h90, OUT_DIR / "forecast_next90.csv")
    forecast_one(h180, OUT_DIR / "forecast_next180.csv")
    forecast_one(h365, OUT_DIR / "forecast_next365.csv", alias_out_csv=OUT_DIR / "forecast_next12m.csv")
    log.info("Saved forecast CSVs (7/30/90/180/365 + aliases 1m/12m).")

    total = time.perf_counter() - t0
    log.info(f"DONE train_eval in {total:.1f}s")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.getLogger("train").exception("FAILED train_eval")
        raise
