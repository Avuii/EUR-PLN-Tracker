from __future__ import annotations
import warnings
from pandas.errors import PerformanceWarning

warnings.filterwarnings("ignore", category=PerformanceWarning)
import argparse
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import (
    get_data_dir,
    get_run_data_dir,
    get_effective_window_for_horizon,
    load_config,
    make_run_dir,
    resolve_path,
    save_run_config,
)


# -------------------- logging --------------------
def setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("build_dataset")
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


# -------------------- helpers --------------------
def _pair_name(currency: str, quote: str = "PLN") -> str:
    return f"{currency.lower()}{quote.lower()}"


def _safe_int_list(values: list[Any], fallback: list[int]) -> list[int]:
    out: list[int] = []
    for v in values:
        try:
            iv = int(v)
            if iv > 0:
                out.append(iv)
        except Exception:
            continue
    return sorted(set(out)) if out else fallback


def _normalize_raw_columns(df: pd.DataFrame, logger: logging.Logger) -> pd.DataFrame:
    d = df.copy()
    d.columns = [str(c).strip() for c in d.columns]

    # date
    if "date" not in d.columns:
        if "effectiveDate" in d.columns:
            d = d.rename(columns={"effectiveDate": "date"})
        elif "Data" in d.columns:
            d = d.rename(columns={"Data": "date"})
        else:
            raise ValueError("Nie znaleziono kolumny daty. Oczekiwano 'date' albo 'effectiveDate'.")

    # value
    if "mid" in d.columns:
        d = d.rename(columns={"mid": "value"})
    elif "value" in d.columns:
        pass
    elif "rate" in d.columns:
        d = d.rename(columns={"rate": "value"})
    elif "kurs" in d.columns:
        d = d.rename(columns={"kurs": "value"})
    else:
        numeric_cols = [c for c in d.columns if c != "date" and pd.api.types.is_numeric_dtype(d[c])]
        if len(numeric_cols) == 1:
            logger.warning(f"Nie znaleziono standardowej kolumny kursu. Używam: {numeric_cols[0]}")
            d = d.rename(columns={numeric_cols[0]: "value"})
        else:
            raise ValueError("Nie znaleziono kolumny kursu. Oczekiwano 'mid' albo 'value'.")

    d["date"] = pd.to_datetime(d["date"], errors="coerce")
    d["value"] = pd.to_numeric(d["value"], errors="coerce")

    d = d.dropna(subset=["date", "value"]).sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    return d[["date", "value"]]


def _find_source_csv(cfg: dict[str, Any], run_dir: Path | None, logger: logging.Logger) -> Path:
    """
    Szuka pliku wejściowego możliwie elastycznie:
    1) cfg["source_csv"] jeśli ustawione
    2) snapshot w run_dir, np. raw_eurpln.csv
    3) pliki raw_*.csv w data/
    4) fallback typu eur_a.csv / eurpln.csv / eur.csv
    """
    currency = str(cfg["currency"]).upper()
    quote = str(cfg.get("target_quote", "PLN")).upper()
    pair = _pair_name(currency, quote)

    explicit = cfg.get("source_csv")
    if explicit:
        p = resolve_path(explicit)
        if p.exists():
            logger.info(f"Używam source_csv z configu: {p}")
            return p

    data_dir = get_data_dir(cfg)
    start = str(cfg["date_range"]["start"])
    end = str(cfg["date_range"]["end"])

    candidates: list[Path] = []

    if run_dir is not None:
        run_data_dir = get_run_data_dir(run_dir, cfg)
        candidates.extend(
            [
                run_data_dir / f"raw_{pair}.csv",
                run_data_dir / f"{pair}.csv",
                run_data_dir / f"{currency.lower()}_a.csv",
                run_dir / f"raw_{pair}.csv",
                run_dir / f"{pair}.csv",
                run_dir / f"{currency.lower()}_a.csv",
            ]
        )

    candidates.extend(
        [
            data_dir / f"raw_{pair}_{start}_{end}.csv",
            data_dir / f"raw_{pair}.csv",
            data_dir / f"{currency.lower()}_a.csv",
            data_dir / f"{pair}.csv",
            data_dir / f"{currency.lower()}.csv",
        ]
    )

    for c in candidates:
        if c.exists():
            logger.info(f"Znaleziono plik źródłowy: {c}")
            return c

    dynamic_patterns = [
        f"raw_{pair}_*.csv",
        f"raw_{pair}.csv",
        f"{currency.lower()}_a*.csv",
        f"{pair}*.csv",
        "*.csv",
    ]

    for pat in dynamic_patterns:
        found = sorted(data_dir.glob(pat), key=lambda p: p.stat().st_mtime, reverse=True)
        if found:
            logger.warning(f"Używam fallbacku źródła danych: {found[0]}")
            return found[0]

    raise FileNotFoundError(f"Nie znaleziono pliku źródłowego CSV w {data_dir}")


# -------------------- feature engineering --------------------
def build_feature_frame(
    df_raw: pd.DataFrame,
    W: int,
    rolling_windows: list[int],
    ema_spans: list[int],
) -> pd.DataFrame:
    d = df_raw.copy().sort_values("date").reset_index(drop=True)
    d["date"] = pd.to_datetime(d["date"])
    d["value"] = d["value"].astype(float)

    # lag_0 = y_t, lag_1 = y_{t-1}, ...
    for k in range(W):
        d[f"lag_{k}"] = d["value"].shift(k)

    d["delta_1"] = d["value"].diff(1)
    d["logret_1"] = np.log(d["value"]).diff(1)

    for win in rolling_windows:
        d[f"sma_{win}"] = d["value"].rolling(win).mean()
        d[f"std_{win}"] = d["value"].rolling(win).std(ddof=0)

    for span in ema_spans:
        d[f"ema_{span}"] = d["value"].ewm(span=span, adjust=False).mean()

    dow = d["date"].dt.dayofweek.astype(int)
    month = d["date"].dt.month.astype(int)

    d["dow"] = dow
    d["month"] = month
    d["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    d["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)
    d["month_sin"] = np.sin(2 * np.pi * (month - 1) / 12.0)
    d["month_cos"] = np.cos(2 * np.pi * (month - 1) / 12.0)

    return d


def make_dataset_for_horizon(
    feat_df: pd.DataFrame,
    H: int,
    W: int,
    rolling_windows: list[int],
    ema_spans: list[int],
) -> pd.DataFrame:
    df = feat_df.copy()

    df["y_t"] = df["value"]
    df["target_date"] = df["date"].shift(-H)
    df["target"] = df["value"].shift(-H)

    target_date = pd.to_datetime(df["target_date"])
    target_dow = target_date.dt.dayofweek.astype("Int64")
    target_month = target_date.dt.month.astype("Int64")

    df["target_dow"] = target_dow
    df["target_month"] = target_month
    df["target_dow_sin"] = np.sin(2 * np.pi * target_dow.astype(float) / 7.0)
    df["target_dow_cos"] = np.cos(2 * np.pi * target_dow.astype(float) / 7.0)
    df["target_month_sin"] = np.sin(2 * np.pi * (target_month.astype(float) - 1.0) / 12.0)
    df["target_month_cos"] = np.cos(2 * np.pi * (target_month.astype(float) - 1.0) / 12.0)

    meta_cols = ["date", "target_date", "y_t", "target"]
    lag_cols = [f"lag_{k}" for k in range(W)]
    roll_cols = [f"sma_{w}" for w in rolling_windows] + [f"std_{w}" for w in rolling_windows]
    ema_cols = [f"ema_{s}" for s in ema_spans]

    other_cols = [
        "delta_1",
        "logret_1",
        *roll_cols,
        *ema_cols,
        "dow",
        "month",
        "dow_sin",
        "dow_cos",
        "month_sin",
        "month_cos",
        "target_dow",
        "target_month",
        "target_dow_sin",
        "target_dow_cos",
        "target_month_sin",
        "target_month_cos",
    ]

    keep = meta_cols + lag_cols + other_cols
    out = df[keep].dropna().reset_index(drop=True)
    return out


# -------------------- main --------------------
def main(config_path: str = "configs/config.json", run_dir: str | None = None) -> None:
    cfg = load_config(config_path)

    if run_dir is None:
        run_path = make_run_dir(cfg["output"]["runs_dir"])
        save_run_config(cfg, run_path)
    else:
        run_path = resolve_path(run_dir)
        run_path.mkdir(parents=True, exist_ok=True)
        (run_path / cfg["output"].get("plots_dir_name", "plots")).mkdir(parents=True, exist_ok=True)
        get_run_data_dir(run_path, cfg)
        if not (run_path / "config.json").exists():
            save_run_config(cfg, run_path)

    logger = setup_logger(run_path / cfg["output"]["log_name"])

    currency = str(cfg["currency"]).upper()
    quote = str(cfg.get("target_quote", "PLN")).upper()
    pair = _pair_name(currency, quote)

    Hs = _safe_int_list(cfg.get("horizons_H", []), [1, 7, 30, 90, 180, 365])
    rolling_windows = _safe_int_list(cfg.get("rolling_windows", []), [5, 10, 20, 60])
    ema_spans = _safe_int_list(cfg.get("ema_spans", []), [10, 20])

    logger.info(f"START build_dataset | pair={pair} | H={Hs}")
    logger.info(f"rolling_windows={rolling_windows} | ema_spans={ema_spans}")

    src_csv = _find_source_csv(cfg, run_path, logger)
    raw_df = pd.read_csv(src_csv)
    raw_df = _normalize_raw_columns(raw_df, logger)

    logger.info(
        f"Source rows={len(raw_df)} | range={raw_df['date'].min().date()}..{raw_df['date'].max().date()}"
    )

    run_data_dir = get_run_data_dir(run_path, cfg)
    raw_snapshot_path = run_data_dir / f"raw_{pair}.csv"
    raw_df.to_csv(raw_snapshot_path, index=False)
    logger.info(f"Saved run raw snapshot: {raw_snapshot_path}")

    global_data_dir = get_data_dir(cfg)
    global_data_dir.mkdir(parents=True, exist_ok=True)
    data_dir = get_run_data_dir(run_path, cfg)

    manifest: dict[str, Any] = {
        "pair": pair,
        "source_csv": str(raw_snapshot_path),
        "original_source_csv": str(src_csv),
        "window_mode": cfg.get("window_mode", "fixed"),
        "window_W_default": int(cfg.get("window_W", 60)),
        "rolling_windows": rolling_windows,
        "ema_spans": ema_spans,
        "datasets": {},
    }

    for H in Hs:
        W = get_effective_window_for_horizon(cfg, H)
        logger.info(f"H={H} -> W={W}")

        feat_df = build_feature_frame(
            raw_df,
            W=W,
            rolling_windows=rolling_windows,
            ema_spans=ema_spans,
        )

        ds = make_dataset_for_horizon(
            feat_df,
            H=H,
            W=W,
            rolling_windows=rolling_windows,
            ema_spans=ema_spans,
        )

        out_path = data_dir / f"ds_H{H}.csv"
        ds.to_csv(out_path, index=False)

        legacy_out_path = global_data_dir / f"ds_H{H}.csv"
        if legacy_out_path != out_path:
            ds.to_csv(legacy_out_path, index=False)

        logger.info(
            f"Saved {out_path} | rows={len(ds)} | cols={ds.shape[1]} | W={W}"
        )
        if legacy_out_path != out_path:
            logger.info(f"Saved legacy dataset copy: {legacy_out_path}")

        manifest["datasets"][f"H{H}"] = {
            "path": str(out_path),
            "rows": int(len(ds)),
            "cols": int(ds.shape[1]),
            "W_used": int(W),
            "lag_cols": int(W),
            "forecast_horizon_H": int(H),
        }

    manifest_path = run_path / "datasets_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info(f"Saved manifest: {manifest_path}")
    logger.info("DONE build_dataset")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/config.json")
    ap.add_argument("--run", default=None, help="runs/<timestamp> ; jeśli brak -> tworzy nowy")
    args = ap.parse_args()

    try:
        main(config_path=args.config, run_dir=args.run)
    except Exception:
        logging.getLogger("build_dataset").exception("FAILED build_dataset")
        raise