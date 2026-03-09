# src/train_eval.py
from __future__ import annotations

import argparse
import json
import logging
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from src.config import (
    get_data_dir,
    load_config,
    make_run_dir,
    model_enabled,
    resolve_path,
    save_run_config,
)

try:
    from statsmodels.tsa.statespace.sarimax import SARIMAX
except Exception:
    SARIMAX = None

try:
    from xgboost import XGBRegressor
except Exception:
    XGBRegressor = None

try:
    from lightgbm import LGBMRegressor
except Exception:
    LGBMRegressor = None


# =========================
# Logging
# =========================
def setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("train_eval")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    fh = logging.FileHandler(log_path, encoding="utf-8", mode="a")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    return logger


# =========================
# JSON / save helpers
# =========================
def to_jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v) for v in obj]

    if isinstance(obj, Path):
        return str(obj)

    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()

    if isinstance(obj, np.datetime64):
        return pd.to_datetime(obj).isoformat()

    if isinstance(obj, (np.integer,)):
        return int(obj)

    if isinstance(obj, (np.floating,)):
        val = float(obj)
        return val if np.isfinite(val) else None

    if isinstance(obj, (np.bool_,)):
        return bool(obj)

    if isinstance(obj, float):
        return obj if np.isfinite(obj) else None

    return obj


def ensure_dir(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)


def save_json(path: Path, obj: Any) -> None:
    ensure_dir(path)
    safe = to_jsonable(obj)
    path.write_text(
        json.dumps(safe, indent=2, ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )


# =========================
# Metrics
# =========================
def mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denom = np.where(y_true == 0, 1.0, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


def smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denom = np.abs(y_true) + np.abs(y_pred)
    denom = np.where(denom == 0, 1.0, denom)
    return float(np.mean(2.0 * np.abs(y_pred - y_true) / denom) * 100.0)


def direction_accuracy(today: np.ndarray, y_true_tH: np.ndarray, y_pred_tH: np.ndarray) -> float:
    true_delta = y_true_tH - today
    pred_delta = y_pred_tH - today
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


def legacy_metric_block(block: Dict[str, Any] | None) -> Dict[str, Any]:
    if not block:
        return {}
    return {
        "MAE": block.get("mae"),
        "RMSE": block.get("rmse"),
        "MAPE": block.get("mape_pct"),
        "SMAPE": block.get("smape_pct"),
        "BIAS": block.get("bias"),
        "DIR_ACC": block.get("dir_acc"),
    }


# =========================
# Split
# =========================
def split_train_val_test(n: int, test_size: int, val_size: int) -> Tuple[slice, slice, slice]:
    if test_size >= n - 50:
        raise ValueError("test_size is too large for dataset length.")

    val_size = max(0, int(val_size))
    if val_size > 0 and (test_size + val_size) >= n - 50:
        val_size = max(0, n - test_size - 50)

    train_end = n - (val_size + test_size)
    val_end = n - test_size

    if train_end < 50:
        raise ValueError("Too few samples for train after split.")

    if val_size == 0:
        return slice(0, train_end), slice(train_end, train_end), slice(train_end, n)

    return slice(0, train_end), slice(train_end, val_end), slice(val_end, n)


# =========================
# Dataset helpers
# =========================
META_COLS = {"date", "target_date", "y_t", "target"}


def _parse_numeric_suffix(name: str, prefix: str) -> Optional[int]:
    if not name.startswith(prefix):
        return None
    try:
        return int(name[len(prefix):])
    except Exception:
        return None


def sort_lag_cols(cols: List[str]) -> List[str]:
    pairs = []
    for c in cols:
        k = _parse_numeric_suffix(c, "lag_")
        if k is not None:
            pairs.append((k, c))
    return [c for _, c in sorted(pairs, key=lambda x: x[0])]


def sort_prefixed_cols(cols: List[str], prefix: str) -> List[str]:
    pairs = []
    for c in cols:
        k = _parse_numeric_suffix(c, prefix)
        if k is not None:
            pairs.append((k, c))
    return [c for _, c in sorted(pairs, key=lambda x: x[0])]


def infer_schema(df: pd.DataFrame) -> Dict[str, Any]:
    cols = list(df.columns)
    lag_cols = sort_lag_cols(cols)
    sma_cols = sort_prefixed_cols(cols, "sma_")
    std_cols = sort_prefixed_cols(cols, "std_")
    ema_cols = sort_prefixed_cols(cols, "ema_")

    if not lag_cols:
        raise ValueError("Dataset nie zawiera kolumn lag_*")

    feature_cols = [c for c in cols if c not in META_COLS]

    return {
        "lag_cols": lag_cols,
        "sma_cols": sma_cols,
        "std_cols": std_cols,
        "ema_cols": ema_cols,
        "feature_cols": feature_cols,
        "W": len(lag_cols),
    }


def _find_ds_csv(data_dir: Path, H: int) -> Path:
    p = data_dir / f"ds_H{H}.csv"
    if not p.exists():
        raise FileNotFoundError(f"Brak datasetu: {p}")
    return p


def _find_source_csv(cfg: dict[str, Any], run_path: Path, logger: logging.Logger) -> Path:
    manifest = run_path / "datasets_manifest.json"
    if manifest.exists():
        try:
            js = json.loads(manifest.read_text(encoding="utf-8"))
            src = js.get("source_csv")
            if src:
                p = resolve_path(src)
                if p.exists():
                    logger.info(f"Źródło z manifestu: {p}")
                    return p
        except Exception:
            pass

    data_dir = get_data_dir(cfg)
    patterns = [
        f"raw_{str(cfg['currency']).lower()}{str(cfg.get('target_quote', 'PLN')).lower()}_*.csv",
        f"raw_{str(cfg['currency']).lower()}{str(cfg.get('target_quote', 'PLN')).lower()}.csv",
        f"{str(cfg['currency']).lower()}_a.csv",
        "*.csv",
    ]
    for pat in patterns:
        found = sorted(data_dir.glob(pat), key=lambda p: p.stat().st_mtime, reverse=True)
        if found:
            logger.warning(f"Używam fallbacku źródła danych: {found[0]}")
            return found[0]

    raise FileNotFoundError("Nie udało się znaleźć surowego pliku CSV do prognoz punktowych.")


# =========================
# Time helpers
# =========================
def next_business_day(date0: pd.Timestamp, H: int) -> pd.Timestamp:
    cur = pd.to_datetime(date0)
    found = 0
    while found < H:
        cur = cur + pd.Timedelta(days=1)
        if cur.dayofweek < 5:
            found += 1
    return cur


# =========================
# Baselines
# =========================
def available_windows_from_cols(cols: List[str], prefix: str) -> List[int]:
    out = []
    for c in cols:
        k = _parse_numeric_suffix(c, prefix)
        if k is not None:
            out.append(k)
    return sorted(set(out))


def pick_best_baselines(
    df_val: pd.DataFrame,
    sma_candidates: List[int],
    ema_candidates: List[int],
) -> Dict[str, Optional[int]]:
    out = {"SMA": None, "EMA": None}

    if len(df_val) == 0:
        out["SMA"] = sma_candidates[0] if sma_candidates else None
        out["EMA"] = ema_candidates[0] if ema_candidates else None
        return out

    if sma_candidates:
        best_mae = None
        best_w = None
        for w in sma_candidates:
            col = f"sma_{w}"
            if col not in df_val.columns:
                continue
            mae = mean_absolute_error(df_val["target"].values, df_val[col].values)
            if best_mae is None or mae < best_mae:
                best_mae = mae
                best_w = w
        out["SMA"] = best_w

    if ema_candidates:
        best_mae = None
        best_w = None
        for w in ema_candidates:
            col = f"ema_{w}"
            if col not in df_val.columns:
                continue
            mae = mean_absolute_error(df_val["target"].values, df_val[col].values)
            if best_mae is None or mae < best_mae:
                best_mae = mae
                best_w = w
        out["EMA"] = best_w

    return out


def baseline_predictions(df_part: pd.DataFrame, best_baselines: Dict[str, Optional[int]]) -> Dict[str, np.ndarray]:
    preds: Dict[str, np.ndarray] = {
        "Naive": df_part["y_t"].values.astype(float),
    }

    sma_w = best_baselines.get("SMA")
    if sma_w is not None and f"sma_{sma_w}" in df_part.columns:
        preds["SMA"] = df_part[f"sma_{sma_w}"].values.astype(float)

    ema_w = best_baselines.get("EMA")
    if ema_w is not None and f"ema_{ema_w}" in df_part.columns:
        preds["EMA"] = df_part[f"ema_{ema_w}"].values.astype(float)

    return preds


def future_baseline_predictions(
    raw_df: pd.DataFrame,
    best_baselines: Dict[str, Optional[int]],
) -> Dict[str, float]:
    vals = raw_df["value"].astype(float)
    out: Dict[str, float] = {
        "Naive": float(vals.iloc[-1]),
    }

    sma_w = best_baselines.get("SMA")
    if sma_w is not None and len(vals) >= sma_w:
        out["SMA"] = float(vals.tail(sma_w).mean())

    ema_w = best_baselines.get("EMA")
    if ema_w is not None and len(vals) >= 2:
        out["EMA"] = float(vals.ewm(span=ema_w, adjust=False).mean().iloc[-1])

    return out


# =========================
# Optional classical TS
# =========================
def sarimax_predict_from_history(
    history: np.ndarray,
    H: int,
    order: Tuple[int, int, int],
    seasonal_order: Optional[Tuple[int, int, int, int]],
) -> float:
    if SARIMAX is None:
        return float(history[-1])

    hist = np.asarray(history, dtype=float)
    hist = hist[np.isfinite(hist)]
    if len(hist) < max(12, order[1] + 5):
        return float(hist[-1])

    seas = seasonal_order if seasonal_order is not None else (0, 0, 0, 0)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = SARIMAX(
                hist,
                order=order,
                seasonal_order=seas,
                trend="c",
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            res = model.fit(disp=False, maxiter=60)
            fc = res.forecast(steps=H)
        return float(np.asarray(fc)[-1])
    except Exception:
        return float(hist[-1])


def sarimax_predict_for_rows(
    df_part: pd.DataFrame,
    lag_cols: List[str],
    H: int,
    order: Tuple[int, int, int],
    seasonal_order: Optional[Tuple[int, int, int, int]],
) -> np.ndarray:
    preds: List[float] = []
    rev_lags = list(reversed(lag_cols))  # oldest -> newest
    for _, row in df_part.iterrows():
        hist = np.array([row[c] for c in rev_lags], dtype=float)
        pred = sarimax_predict_from_history(hist, H=H, order=order, seasonal_order=seasonal_order)
        preds.append(pred)
    return np.asarray(preds, dtype=float)


# =========================
# ML models
# =========================
def make_models(cfg: dict[str, Any], seed: int) -> Dict[str, Any]:
    models: Dict[str, Any] = {}

    if model_enabled(cfg, "Ridge"):
        models["Ridge"] = Pipeline([
            ("scaler", StandardScaler()),
            ("model", Ridge()),
        ])

    if model_enabled(cfg, "ElasticNet"):
        models["ElasticNet"] = Pipeline([
            ("scaler", StandardScaler()),
            ("model", ElasticNet(max_iter=50000, random_state=seed)),
        ])

    if model_enabled(cfg, "MLPRegressor"):
        models["MLPRegressor"] = Pipeline([
            ("scaler", StandardScaler()),
            ("model", MLPRegressor(
                random_state=seed,
                max_iter=1500,
                early_stopping=True,
                validation_fraction=0.15,
                n_iter_no_change=30,
                shuffle=False,
            )),
        ])

    if model_enabled(cfg, "RandomForest"):
        models["RandomForest"] = RandomForestRegressor(random_state=seed, n_jobs=-1)

    if model_enabled(cfg, "ExtraTrees"):
        models["ExtraTrees"] = ExtraTreesRegressor(random_state=seed, n_jobs=-1)

    if model_enabled(cfg, "HistGB"):
        models["HistGB"] = HistGradientBoostingRegressor(random_state=seed, early_stopping=False)

    if (
        model_enabled(cfg, "XGBoost")
        and cfg.get("models", {}).get("optional_backends", {}).get("xgboost_enabled", False)
        and XGBRegressor is not None
    ):
        models["XGBoost"] = XGBRegressor(
            random_state=seed,
            n_estimators=500,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="reg:squarederror",
            n_jobs=-1,
        )

    if (
        model_enabled(cfg, "LightGBM")
        and cfg.get("models", {}).get("optional_backends", {}).get("lightgbm_enabled", False)
        and LGBMRegressor is not None
    ):
        models["LightGBM"] = LGBMRegressor(
            random_state=seed,
            n_estimators=500,
            learning_rate=0.05,
            num_leaves=31,
        )

    return models


def get_search_spaces(cfg: dict[str, Any]) -> Dict[str, Dict[str, list]]:
    spaces: Dict[str, Dict[str, list]] = {}

    if model_enabled(cfg, "Ridge"):
        spaces["Ridge"] = {
            "model__alpha": [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0],
        }

    if model_enabled(cfg, "ElasticNet"):
        spaces["ElasticNet"] = {
            "model__alpha": [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1],
            "model__l1_ratio": [0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.95],
        }

    if model_enabled(cfg, "MLPRegressor"):
        spaces["MLPRegressor"] = {
            "model__hidden_layer_sizes": [(32,), (64,), (64, 32), (128, 64)],
            "model__alpha": [1e-5, 1e-4, 5e-4, 1e-3, 5e-3],
            "model__learning_rate_init": [5e-4, 1e-3, 2e-3],
        }

    if model_enabled(cfg, "RandomForest"):
        spaces["RandomForest"] = {
            "n_estimators": [400, 600, 900, 1200],
            "max_depth": [None, 4, 6, 8, 12, 16],
            "min_samples_leaf": [1, 2, 4, 8],
            "max_features": ["sqrt", "log2", 0.6, 0.8],
        }

    if model_enabled(cfg, "ExtraTrees"):
        spaces["ExtraTrees"] = {
            "n_estimators": [600, 900, 1200, 1500],
            "max_depth": [None, 6, 8, 12, 16],
            "min_samples_leaf": [1, 2, 4, 8],
            "max_features": ["sqrt", "log2", 0.6, 0.8],
        }

    if model_enabled(cfg, "HistGB"):
        spaces["HistGB"] = {
            "learning_rate": [0.01, 0.03, 0.05, 0.1],
            "max_depth": [3, 4, 6, 8, None],
            "max_iter": [200, 400, 600, 800],
            "min_samples_leaf": [10, 20, 40, 80],
            "l2_regularization": [0.0, 0.01, 0.1, 1.0],
        }

    if model_enabled(cfg, "XGBoost") and XGBRegressor is not None:
        spaces["XGBoost"] = {
            "n_estimators": [300, 500, 700],
            "max_depth": [3, 4, 6, 8],
            "learning_rate": [0.02, 0.05, 0.1],
            "subsample": [0.8, 0.9, 1.0],
            "colsample_bytree": [0.7, 0.9, 1.0],
        }

    if model_enabled(cfg, "LightGBM") and LGBMRegressor is not None:
        spaces["LightGBM"] = {
            "n_estimators": [300, 500, 700],
            "learning_rate": [0.02, 0.05, 0.1],
            "num_leaves": [15, 31, 63],
            "min_child_samples": [10, 20, 40],
        }

    return spaces


def tune_model(
    name: str,
    estimator: Any,
    params: Dict[str, Any],
    X_train: np.ndarray,
    y_train: np.ndarray,
    cfg: dict[str, Any],
    seed: int,
    logger: logging.Logger,
) -> Tuple[Any, Dict[str, Any]]:
    n_iter_map = cfg.get("training", {}).get("random_search_iter", {}) or {}
    n_iter = int(n_iter_map.get(name, 20))
    n_splits = int(cfg.get("training", {}).get("cv_splits", 5))

    logger.info(f"[TUNE] {name} | n_iter={n_iter} | cv={n_splits}")
    tscv = TimeSeriesSplit(n_splits=n_splits)

    rs = RandomizedSearchCV(
        estimator,
        param_distributions=params,
        n_iter=n_iter,
        cv=tscv,
        scoring="neg_mean_absolute_error",
        random_state=seed,
        n_jobs=-1,
        verbose=0,
    )
    rs.fit(X_train, y_train)
    logger.info(f"[TUNE] {name} best={rs.best_params_}")
    return rs.best_estimator_, to_jsonable(rs.best_params_)


# =========================
# Backtest
# =========================
def walk_forward_backtest_level(
    model,
    X_all: np.ndarray,
    y_all: np.ndarray,
    today_all: np.ndarray,
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
        y_tr = y_all[:train_end]

        X_te = X_all[train_end:test_end]
        y_te = y_all[train_end:test_end]
        today_te = today_all[train_end:test_end]

        m = clone(model)
        m.fit(X_tr, y_tr)
        pred = m.predict(X_te)

        met = compute_metrics(y_te, pred, today_te)
        windows.append(
            {
                "window": int(w + 1),
                "train_end_index": int(train_end),
                "test_start_index": int(train_end),
                "test_end_index": int(test_end),
                **met,
            }
        )

        cur = test_end
        if cur >= start_idx + total_len:
            break

    out = {"n_windows": len(windows), "window_len": int(win_len), "windows": windows}
    if windows:
        out["mae_avg"] = float(np.mean([w["mae"] for w in windows]))
        out["rmse_avg"] = float(np.mean([w["rmse"] for w in windows]))
    else:
        out["mae_avg"] = None
        out["rmse_avg"] = None
    return out


# =========================
# Future feature row
# =========================
def build_future_feature_row(
    raw_df: pd.DataFrame,
    feature_cols: List[str],
    H: int,
) -> Tuple[Dict[str, Any], pd.Timestamp]:
    d = raw_df.copy().sort_values("date").reset_index(drop=True)
    d["date"] = pd.to_datetime(d["date"])
    d["value"] = d["value"].astype(float)

    vals = d["value"].values
    cur_date = pd.to_datetime(d["date"].iloc[-1])
    target_date = next_business_day(cur_date, H)

    row: Dict[str, Any] = {}

    for col in feature_cols:
        if col.startswith("lag_"):
            k = int(col.split("_")[1])
            row[col] = float(vals[-1 - k]) if len(vals) > k else np.nan

        elif col == "delta_1":
            row[col] = float(vals[-1] - vals[-2]) if len(vals) > 1 else np.nan

        elif col == "logret_1":
            row[col] = float(np.log(vals[-1]) - np.log(vals[-2])) if len(vals) > 1 else np.nan

        elif col.startswith("sma_"):
            w = int(col.split("_")[1])
            row[col] = float(pd.Series(vals).tail(w).mean()) if len(vals) >= w else np.nan

        elif col.startswith("std_"):
            w = int(col.split("_")[1])
            row[col] = float(pd.Series(vals).tail(w).std(ddof=0)) if len(vals) >= w else np.nan

        elif col.startswith("ema_"):
            span = int(col.split("_")[1])
            row[col] = float(pd.Series(vals).ewm(span=span, adjust=False).mean().iloc[-1])

        elif col == "dow":
            row[col] = int(cur_date.dayofweek)

        elif col == "month":
            row[col] = int(cur_date.month)

        elif col == "dow_sin":
            row[col] = float(np.sin(2 * np.pi * cur_date.dayofweek / 7.0))

        elif col == "dow_cos":
            row[col] = float(np.cos(2 * np.pi * cur_date.dayofweek / 7.0))

        elif col == "month_sin":
            row[col] = float(np.sin(2 * np.pi * (cur_date.month - 1) / 12.0))

        elif col == "month_cos":
            row[col] = float(np.cos(2 * np.pi * (cur_date.month - 1) / 12.0))

        elif col == "target_dow":
            row[col] = int(target_date.dayofweek)

        elif col == "target_month":
            row[col] = int(target_date.month)

        elif col == "target_dow_sin":
            row[col] = float(np.sin(2 * np.pi * target_date.dayofweek / 7.0))

        elif col == "target_dow_cos":
            row[col] = float(np.cos(2 * np.pi * target_date.dayofweek / 7.0))

        elif col == "target_month_sin":
            row[col] = float(np.sin(2 * np.pi * (target_date.month - 1) / 12.0))

        elif col == "target_month_cos":
            row[col] = float(np.cos(2 * np.pi * (target_date.month - 1) / 12.0))

        else:
            row[col] = np.nan

    return row, target_date


# =========================
# Main horizon evaluation
# =========================
def eval_horizon(
    H: int,
    cfg: dict[str, Any],
    run_path: Path,
    logger: logging.Logger,
    no_tuning_override: Optional[bool],
    val_size_override: Optional[int],
    test_size_override: Optional[int],
    backtest_windows_override: Optional[int],
) -> Dict[str, Any]:
    data_dir = get_data_dir(cfg)
    ds_path = _find_ds_csv(data_dir, H)
    df = pd.read_csv(ds_path, parse_dates=["date", "target_date"]).sort_values("date").reset_index(drop=True)
    schema = infer_schema(df)

    feature_cols = schema["feature_cols"]
    lag_cols = schema["lag_cols"]
    W = schema["W"]

    logger.info(f"H={H} | dataset={ds_path} | rows={len(df)} | inferred W={W}")

    split_cfg = cfg.get("split", {})
    val_size = int(val_size_override if val_size_override is not None else split_cfg.get("val_size", 130))
    test_size = int(test_size_override if test_size_override is not None else split_cfg.get("test_size", 260))

    train_sl, val_sl, test_sl = split_train_val_test(len(df), test_size=test_size, val_size=val_size)

    X_all = df[feature_cols].values
    y_all = df["target"].values.astype(float)
    today_all = df["y_t"].values.astype(float)

    X_train, y_train = X_all[train_sl], y_all[train_sl]
    X_val, y_val = X_all[val_sl], y_all[val_sl]
    X_test, y_test = X_all[test_sl], y_all[test_sl]

    today_val = today_all[val_sl]
    today_test = today_all[test_sl]

    df_val = df.iloc[val_sl].copy()
    df_test = df.iloc[test_sl].copy()

    logger.info(
        f"H={H} | split train={len(X_train)} | val={len(X_val)} | test={len(X_test)}"
    )

    # -------------------- baselines --------------------
    enabled = set([m.lower() for m in cfg.get("models", {}).get("enabled", [])])

    sma_candidates = available_windows_from_cols(schema["sma_cols"], "sma_")
    ema_candidates = available_windows_from_cols(schema["ema_cols"], "ema_")

    baseline_choice = pick_best_baselines(df_val, sma_candidates, ema_candidates)
    logger.info(f"H={H} | best baselines = {baseline_choice}")

    preds_val: Dict[str, np.ndarray] = {}
    preds_test: Dict[str, np.ndarray] = {}

    base_val_all = baseline_predictions(df_val, baseline_choice)
    base_test_all = baseline_predictions(df_test, baseline_choice)

    if "naive" in enabled:
        preds_val["Naive"] = base_val_all["Naive"]
        preds_test["Naive"] = base_test_all["Naive"]

    if "sma" in enabled and "SMA" in base_val_all and "SMA" in base_test_all:
        preds_val["SMA"] = base_val_all["SMA"]
        preds_test["SMA"] = base_test_all["SMA"]

    if "ema" in enabled and "EMA" in base_val_all and "EMA" in base_test_all:
        preds_val["EMA"] = base_val_all["EMA"]
        preds_test["EMA"] = base_test_all["EMA"]

    # -------------------- ML models --------------------
    models = make_models(cfg, seed=int(cfg.get("seed", 123)))
    search_spaces = get_search_spaces(cfg)
    no_tuning = bool(no_tuning_override) if no_tuning_override is not None else bool(cfg.get("training", {}).get("no_tuning", False))

    best_params_by_model: Dict[str, Any] = {}

    if not no_tuning:
        for name in list(models.keys()):
            if name not in search_spaces:
                best_params_by_model[name] = {}
                continue
            try:
                tuned_model, best_params = tune_model(
                    name=name,
                    estimator=models[name],
                    params=search_spaces[name],
                    X_train=X_train,
                    y_train=y_train,
                    cfg=cfg,
                    seed=int(cfg.get("seed", 123)),
                    logger=logger,
                )
                models[name] = tuned_model
                best_params_by_model[name] = best_params
            except Exception as e:
                logger.warning(f"H={H} | tuning failed for {name}: {e}")
                best_params_by_model[name] = {}
    else:
        logger.info(f"H={H} | tuning disabled")
        best_params_by_model = {name: {} for name in models.keys()}

    def _fit_predict(model, X_tr, y_tr, X_out) -> np.ndarray:
        m = clone(model)
        m.fit(X_tr, y_tr)
        return m.predict(X_out)

    for name, model in models.items():
        try:
            if len(X_val) > 0:
                preds_val[name] = _fit_predict(model, X_train, y_train, X_val)
            preds_test[name] = _fit_predict(model, np.vstack([X_train, X_val]) if len(X_val) > 0 else X_train,
                                            np.concatenate([y_train, y_val]) if len(X_val) > 0 else y_train, X_test)
        except Exception as e:
            logger.warning(f"H={H} | prediction failed for {name}: {e}")

    # -------------------- SARIMAX --------------------
    sarimax_cfg = cfg.get("models", {}).get("sarimax", {}) or {}
    sarimax_enabled = model_enabled(cfg, "SARIMAX") and bool(sarimax_cfg.get("enabled", True))
    sarimax_order = tuple(sarimax_cfg.get("order", [1, 1, 1]))
    seasonal_order = sarimax_cfg.get("seasonal_order", None)
    seasonal_order = tuple(seasonal_order) if seasonal_order is not None else None

    if sarimax_enabled:
        logger.info(f"H={H} | running SARIMAX fair predictions")
        try:
            if len(df_val) > 0:
                preds_val["SARIMAX"] = sarimax_predict_for_rows(df_val, lag_cols, H, sarimax_order, seasonal_order)
            preds_test["SARIMAX"] = sarimax_predict_for_rows(df_test, lag_cols, H, sarimax_order, seasonal_order)
        except Exception as e:
            logger.warning(f"H={H} | SARIMAX failed: {e}")

    # -------------------- choose best on validation --------------------
    metrics_models: Dict[str, Any] = {}
    val_scores: Dict[str, float] = {}

    if len(X_val) > 0:
        for name, yhat in preds_val.items():
            met = compute_metrics(y_val, yhat, today_val)
            metrics_models.setdefault(name, {})
            metrics_models[name]["val"] = met
            val_scores[name] = met["mae"]

        best_name = min(val_scores, key=val_scores.get) if val_scores else "Naive"
    else:
        best_name = "Naive" if "Naive" in preds_test else (list(preds_test.keys())[0] if preds_test else "Naive")

    logger.info(f"H={H} | best model = {best_name}")

    for name, yhat in preds_test.items():
        met = compute_metrics(y_test, yhat, today_test)
        metrics_models.setdefault(name, {})
        metrics_models[name]["test"] = met

    # -------------------- backtest (ML only, no baselines) --------------------
    backtest_windows = int(backtest_windows_override if backtest_windows_override is not None else cfg.get("backtest", {}).get("windows", 5))
    full_end = val_sl.stop if val_sl.stop > val_sl.start else train_sl.stop
    test_len = len(X_test)

    backtest_out: Dict[str, Any] = {}
    for name, model in models.items():
        try:
            backtest_out[name] = walk_forward_backtest_level(
                model=model,
                X_all=X_all,
                y_all=y_all,
                today_all=today_all,
                start_idx=full_end,
                total_len=test_len,
                n_windows=backtest_windows,
            )
        except Exception as e:
            logger.warning(f"H={H} | backtest failed for {name}: {e}")

    # -------------------- save test predictions per horizon --------------------
    pred_df = pd.DataFrame({
        "date": pd.to_datetime(df_test["date"]),
        "target_date": pd.to_datetime(df_test["target_date"]),
        "y_t": df_test["y_t"].astype(float).values,
        "true_target": y_test,
        "best_model": best_name,
    })

    best_test_pred = preds_test.get(best_name)
    if best_test_pred is not None:
        pred_df["pred_best"] = best_test_pred

    for name, arr in preds_test.items():
        pred_df[f"pred_{name}"] = arr

    for col in [c for c in pred_df.columns if c.startswith("pred_")]:
        pred_df[f"err_{col}"] = pred_df[col] - pred_df["true_target"]
        pred_df[f"abs_err_{col}"] = np.abs(pred_df[f"err_{col}"])

    pred_csv = run_path / f"predictions_H{H}.csv"
    pred_df.to_csv(pred_csv, index=False)
    logger.info(f"H={H} | saved {pred_csv}")

    # -------------------- point forecast for future --------------------
    src_raw = _find_source_csv(cfg, run_path, logger)
    raw_df = pd.read_csv(src_raw)
    raw_df.columns = [str(c).strip() for c in raw_df.columns]

    if "date" not in raw_df.columns and "effectiveDate" in raw_df.columns:
        raw_df = raw_df.rename(columns={"effectiveDate": "date"})
    if "value" not in raw_df.columns and "mid" in raw_df.columns:
        raw_df = raw_df.rename(columns={"mid": "value"})

    raw_df["date"] = pd.to_datetime(raw_df["date"])
    raw_df["value"] = pd.to_numeric(raw_df["value"], errors="coerce")
    raw_df = raw_df.dropna(subset=["date", "value"]).sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)

    future_row, future_target_date = build_future_feature_row(raw_df, feature_cols=feature_cols, H=H)
    future_X = pd.DataFrame([future_row])[feature_cols]

    point_forecast: Dict[str, Any] = {
        "H": int(H),
        "forecast_target_date": str(pd.to_datetime(future_target_date).date()),
        "latest_observation_date": str(pd.to_datetime(raw_df["date"].iloc[-1]).date()),
        "latest_value": float(raw_df["value"].iloc[-1]),
        "best_model": best_name,
    }

    # baselines future
    future_base = future_baseline_predictions(raw_df, baseline_choice)
    for name, value in future_base.items():
        if name in preds_test or name.lower() in enabled:
            point_forecast[name] = float(value)

    # final fit on train+val for point forecast
    X_tr_full = np.vstack([X_train, X_val]) if len(X_val) > 0 else X_train
    y_tr_full = np.concatenate([y_train, y_val]) if len(X_val) > 0 else y_train

    fitted_models: Dict[str, Any] = {}
    for name, model in models.items():
        try:
            m = clone(model)
            m.fit(X_tr_full, y_tr_full)
            fitted_models[name] = m
            point_forecast[name] = float(m.predict(future_X)[0])
        except Exception as e:
            logger.warning(f"H={H} | future forecast failed for {name}: {e}")

    if sarimax_enabled:
        try:
            hist = raw_df["value"].astype(float).values[-W:]
            point_forecast["SARIMAX"] = sarimax_predict_from_history(
                history=hist,
                H=H,
                order=sarimax_order,
                seasonal_order=seasonal_order,
            )
        except Exception as e:
            logger.warning(f"H={H} | future SARIMAX failed: {e}")

    point_forecast["best_value"] = point_forecast.get(best_name)

    # intervals for tree-based best model
    interval_cfg = cfg.get("models", {}).get("prediction_intervals", {}) or {}
    if interval_cfg.get("enabled", True):
        p80 = interval_cfg.get("p80", [0.10, 0.90])
        p95 = interval_cfg.get("p95", [0.025, 0.975])

        best_model_obj = fitted_models.get(best_name)
        if best_model_obj is not None and hasattr(best_model_obj, "estimators_"):
            try:
                preds = np.vstack([est.predict(future_X.values) for est in best_model_obj.estimators_]).ravel()
                point_forecast["p80_low"] = float(np.quantile(preds, p80[0]))
                point_forecast["p80_high"] = float(np.quantile(preds, p80[1]))
                point_forecast["p95_low"] = float(np.quantile(preds, p95[0]))
                point_forecast["p95_high"] = float(np.quantile(preds, p95[1]))
            except Exception as e:
                logger.warning(f"H={H} | interval estimation failed: {e}")

    # aliases for simpler frontend
    aliases = {
        "Naive": "naive",
        "SMA": "sma",
        "EMA": "ema",
        "Ridge": "ridge",
        "ElasticNet": "elastic",
        "MLPRegressor": "mlp",
        "RandomForest": "rf",
        "ExtraTrees": "extra",
        "HistGB": "hgb",
        "SARIMAX": "sarimax",
        "XGBoost": "xgb",
        "LightGBM": "lgbm",
    }

    for orig, alias in aliases.items():
        if orig in point_forecast:
            point_forecast[alias] = point_forecast[orig]

    return {
        "H": int(H),
        "dataset_path": str(ds_path),
        "W_used": int(W),
        "feature_cols": feature_cols,
        "lag_cols": lag_cols,
        "best_model": best_name,
        "baseline_choice": baseline_choice,
        "metrics_models": metrics_models,
        "predictions_csv": str(pred_csv),
        "point_forecast": point_forecast,
        "backtest": backtest_out,
        "best_params": best_params_by_model,
    }


# =========================
# Main
# =========================
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/config.json")
    ap.add_argument("--run", default=None, help="runs/<timestamp>; jeśli brak -> tworzy nowy")
    ap.add_argument("--log-level", default="INFO")

    ap.add_argument("--no-tuning", action="store_true")
    ap.add_argument("--val-size-samples", type=int, default=None)
    ap.add_argument("--test-size-samples", type=int, default=None)
    ap.add_argument("--backtest-windows", type=int, default=None)

    args = ap.parse_args()

    cfg = load_config(args.config)

    if args.run is None:
        run_path = make_run_dir(cfg["output"]["runs_dir"])
        save_run_config(cfg, run_path)
    else:
        run_path = resolve_path(args.run)
        run_path.mkdir(parents=True, exist_ok=True)
        if not (run_path / "config.json").exists():
            save_run_config(cfg, run_path)

    logger = setup_logger(run_path / cfg["output"]["log_name"])
    logger.info("START train_eval")

    Hs = [int(h) for h in cfg.get("horizons_H", [])]
    metrics_by_horizon: Dict[str, Any] = {}
    backtest_by_horizon: Dict[str, Any] = {}
    best_params_by_horizon: Dict[str, Any] = {}
    point_forecast_rows: List[Dict[str, Any]] = []
    metrics_rows: List[Dict[str, Any]] = []

    t0 = pd.Timestamp.utcnow()

    for H in Hs:
        out = eval_horizon(
            H=H,
            cfg=cfg,
            run_path=run_path,
            logger=logger,
            no_tuning_override=(True if args.no_tuning else None),
            val_size_override=args.val_size_samples,
            test_size_override=args.test_size_samples,
            backtest_windows_override=args.backtest_windows,
        )

        H_key = str(H)
        metrics_models = out["metrics_models"]

        horizon_payload = {
            "best_model": out["best_model"],
            "W_used": out["W_used"],
            "dataset_path": out["dataset_path"],
            "baseline_choice": out["baseline_choice"],
            "models": {},
        }

        for model_name, blocks in metrics_models.items():
            horizon_payload["models"][model_name] = {}
            if "val" in blocks:
                horizon_payload["models"][model_name]["val"] = blocks["val"]
            if "test" in blocks:
                horizon_payload["models"][model_name]["test"] = blocks["test"]

            for split_name in ["val", "test"]:
                block = blocks.get(split_name)
                if block:
                    metrics_rows.append(
                        {
                            "H": int(H),
                            "model": model_name,
                            "split": split_name,
                            "mae": block.get("mae"),
                            "rmse": block.get("rmse"),
                            "mape_pct": block.get("mape_pct"),
                            "smape_pct": block.get("smape_pct"),
                            "bias": block.get("bias"),
                            "dir_acc": block.get("dir_acc"),
                        }
                    )

        # aliasy per horizon dla prostszego frontu
        aliases = {
            "Naive": "naive",
            "SMA": "sma",
            "EMA": "ema",
            "Ridge": "ridge",
            "ElasticNet": "elastic",
            "MLPRegressor": "mlp",
            "RandomForest": "rf",
            "ExtraTrees": "extra",
            "HistGB": "hgb",
            "SARIMAX": "sarimax",
            "XGBoost": "xgb",
            "LightGBM": "lgbm",
        }

        for model_name, alias in aliases.items():
            test_block = horizon_payload["models"].get(model_name, {}).get("test")
            if test_block:
                horizon_payload[alias] = legacy_metric_block(test_block)

        metrics_by_horizon[H_key] = horizon_payload
        backtest_by_horizon[H_key] = out["backtest"]
        best_params_by_horizon[H_key] = out["best_params"]
        point_forecast_rows.append(out["point_forecast"])

    summary = {
        "pair": f"{cfg['currency']}/{cfg.get('target_quote', 'PLN')}",
        "generated_at": str(pd.Timestamp.utcnow()),
        "horizons": Hs,
        "best_model_by_horizon": {
            str(H): metrics_by_horizon[str(H)]["best_model"] for H in Hs
        },
        "run_dir": str(run_path),
    }

    run_config = {
        "pair": f"{cfg['currency']}/{cfg.get('target_quote', 'PLN')}",
        "date_range": cfg.get("date_range"),
        "horizons_H": Hs,
        "window_mode": cfg.get("window_mode"),
        "window_by_horizon": cfg.get("window_by_horizon"),
        "split": cfg.get("split"),
        "training": cfg.get("training"),
        "backtest": cfg.get("backtest"),
        "viz": cfg.get("viz"),
        "models_enabled": cfg.get("models", {}).get("enabled", []),
        "seed": int(cfg.get("seed", 123)),
    }

    metrics_json = {
        "by_horizon": metrics_by_horizon,
        "summary": summary,
    }

    # files
    save_json(run_path / "run_config.json", run_config)
    save_json(run_path / "metrics.json", metrics_json)
    save_json(run_path / "backtest.json", backtest_by_horizon)
    save_json(run_path / "best_ml_params.json", best_params_by_horizon)
    save_json(run_path / "summary.json", summary)

    metrics_df = pd.DataFrame(metrics_rows)
    metrics_df.to_csv(run_path / "metrics.csv", index=False)

    point_df = pd.DataFrame(point_forecast_rows).sort_values("H")
    point_df.to_csv(run_path / "forecast_points.csv", index=False)

    logger.info(f"Saved {run_path / 'run_config.json'}")
    logger.info(f"Saved {run_path / 'metrics.json'}")
    logger.info(f"Saved {run_path / 'metrics.csv'}")
    logger.info(f"Saved {run_path / 'forecast_points.csv'}")
    logger.info(f"Saved {run_path / 'backtest.json'}")
    logger.info(f"Saved {run_path / 'best_ml_params.json'}")
    logger.info(f"Saved {run_path / 'summary.json'}")

    dt = pd.Timestamp.utcnow() - t0
    logger.info(f"DONE train_eval in {dt}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.getLogger("train_eval").exception("FAILED train_eval")
        raise