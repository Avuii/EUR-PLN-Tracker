# src/fetch_nbp.py
from __future__ import annotations
import warnings
from pandas.errors import PerformanceWarning

warnings.filterwarnings("ignore", category=PerformanceWarning)
import argparse
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import List, Tuple

import pandas as pd
import requests

from .config import get_data_dir, get_run_data_dir, load_config, resolve_path, save_run_config

TABLE = "A"
FMT = "json"
BASE = "https://api.nbp.pl/api/exchangerates/rates"

# bezpiecznie poniżej limitu NBP (~367)
MAX_DAYS_PER_REQ = 360

log = logging.getLogger("fetch_nbp")


# =========================================================
# Logging
# =========================================================
def setup_logging(level: str) -> None:
    lvl = getattr(logging, str(level).upper(), logging.INFO)
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )


# =========================================================
# Helpers
# =========================================================
def _pair_name(currency: str, quote: str = "PLN") -> str:
    return f"{currency.lower()}{quote.lower()}"


def _url(table: str, code: str, start: date, end: date) -> str:
    return f"{BASE}/{table}/{code}/{start.isoformat()}/{end.isoformat()}/?format={FMT}"


def _fetch_range(table: str, code: str, start: date, end: date) -> List[Tuple[date, float]]:
    if start > end:
        return []

    out: List[Tuple[date, float]] = []
    cur = start

    while cur <= end:
        chunk_end = min(end, cur + timedelta(days=MAX_DAYS_PER_REQ - 1))
        url = _url(table, code, cur, chunk_end)
        log.info(f"GET {cur.isoformat()}..{chunk_end.isoformat()}")
        r = requests.get(url, timeout=30)
        r.raise_for_status()

        js = r.json()
        rates = js.get("rates", [])
        for it in rates:
            d = date.fromisoformat(it["effectiveDate"])
            v = float(it["mid"])
            out.append((d, v))

        cur = chunk_end + timedelta(days=1)

    return out


def _load_existing_daily(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["date", "value"])

    df = pd.read_csv(path, parse_dates=["date"])
    df = df.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["date", "value"]).reset_index(drop=True)
    return df[["date", "value"]]


def _save_daily(path: Path, df: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = df.copy().sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    out["date"] = pd.to_datetime(out["date"]).dt.date.astype(str)
    out.to_csv(path, index=False)
    log.info(f"Saved {path} rows={len(out)}")


def _daily_to_hourly_derived(
    daily_df: pd.DataFrame,
    fill_weekends: bool,
) -> pd.DataFrame:
    d = daily_df.copy()
    d["date"] = pd.to_datetime(d["date"]).dt.normalize()
    d = d.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)

    if d.empty:
        return pd.DataFrame(columns=["date", "value"])

    if fill_weekends:
        full_days = pd.date_range(d["date"].min(), d["date"].max(), freq="D")
        d = d.set_index("date").reindex(full_days).ffill().reset_index()
        d = d.rename(columns={"index": "date"})

    rows = []
    for dt, val in zip(d["date"], d["value"]):
        base = pd.to_datetime(dt)
        for h in range(24):
            rows.append({"date": base + pd.Timedelta(hours=h), "value": float(val)})

    return pd.DataFrame(rows)


def _parse_date_range(cfg: dict) -> tuple[date, date]:
    start = date.fromisoformat(cfg["date_range"]["start"])
    end = date.fromisoformat(cfg["date_range"]["end"])
    return start, end


def _default_daily_paths(cfg: dict, run_dir: Path | None) -> tuple[Path, Path]:
    currency = str(cfg["currency"]).upper()
    quote = str(cfg.get("target_quote", "PLN")).upper()
    pair = _pair_name(currency, quote)

    data_dir = get_data_dir(cfg)
    start = cfg["date_range"]["start"]
    end = cfg["date_range"]["end"]

    canonical = data_dir / f"raw_{pair}_{start}_{end}.csv"
    latest = data_dir / f"raw_{pair}.csv"

    if run_dir is not None:
        run_snapshot = get_run_data_dir(run_dir, cfg) / f"raw_{pair}.csv"
    else:
        run_snapshot = latest

    return canonical, latest if run_dir is None else run_snapshot


def _default_hourly_paths(cfg: dict, run_dir: Path | None) -> tuple[Path, Path]:
    currency = str(cfg["currency"]).upper()
    quote = str(cfg.get("target_quote", "PLN")).upper()
    pair = _pair_name(currency, quote)

    data_dir = get_data_dir(cfg)
    start = cfg["date_range"]["start"]
    end = cfg["date_range"]["end"]

    canonical = data_dir / f"raw_{pair}_hourly_{start}_{end}.csv"
    latest = data_dir / f"raw_{pair}_hourly.csv"

    if run_dir is not None:
        run_snapshot = get_run_data_dir(run_dir, cfg) / f"raw_{pair}_hourly.csv"
    else:
        run_snapshot = latest

    return canonical, latest if run_dir is None else run_snapshot


# =========================================================
# Main
# =========================================================
def main() -> None:
    ap = argparse.ArgumentParser()

    # nowy pipeline
    ap.add_argument("--config", type=str, default=None)
    ap.add_argument("--run", type=str, default=None)

    # legacy CLI
    ap.add_argument("--years", type=int, default=None)
    ap.add_argument("--out", type=str, default=None)

    ap.add_argument("--freq", type=str, default="daily", choices=["daily", "hourly"])
    ap.add_argument("--hourly-provider", type=str, default="derived", choices=["derived"])
    ap.add_argument("--fill-weekends", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--log-level", type=str, default="INFO")

    args = ap.parse_args()
    setup_logging(args.log_level)

    cfg = load_config(args.config) if args.config else None
    run_dir = resolve_path(args.run) if args.run else None

    if run_dir is not None:
        run_dir.mkdir(parents=True, exist_ok=True)
        if cfg is not None:
            get_run_data_dir(run_dir, cfg)
        if cfg is not None and not (run_dir / "config.json").exists():
            save_run_config(cfg, run_dir)

    # -----------------------------------------------------
    # Resolve settings
    # -----------------------------------------------------
    if cfg is not None:
        currency = str(cfg["currency"]).upper()
        quote = str(cfg.get("target_quote", "PLN")).upper()
        table = str(cfg.get("nbp_table", TABLE)).upper()

        start, end = _parse_date_range(cfg)

        if args.years is not None:
            # jawny override legacy
            end = date.today()
            start = end - timedelta(days=int(args.years * 365.25))
    else:
        currency = "EUR"
        quote = "PLN"
        table = TABLE

        end = date.today()
        years = int(args.years) if args.years is not None else 5
        start = end - timedelta(days=int(years * 365.25))

    pair = _pair_name(currency, quote)

    log.info(
        f"START fetch | pair={currency}/{quote} | freq={args.freq} | range={start.isoformat()}..{end.isoformat()} | refresh={args.refresh}"
    )

    # -----------------------------------------------------
    # Resolve output paths
    # -----------------------------------------------------
    if args.out:
        out_path = resolve_path(args.out)
        canonical_out = out_path
        secondary_out = None
    else:
        if cfg is None:
            raise ValueError("Bez --config musisz podać --out.")

        if args.freq == "daily":
            canonical_out, secondary_out = _default_daily_paths(cfg, run_dir)
        else:
            canonical_out, secondary_out = _default_hourly_paths(cfg, run_dir)

        out_path = canonical_out

    # -----------------------------------------------------
    # Always build/refresh daily base first
    # -----------------------------------------------------
    if cfg is not None:
        daily_canonical, daily_secondary = _default_daily_paths(cfg, run_dir)
    else:
        if args.out and args.freq == "daily":
            daily_canonical, daily_secondary = resolve_path(args.out), None
        elif args.out and args.freq == "hourly":
            daily_canonical, daily_secondary = resolve_path(args.out).with_name("eur_a.csv"), None
        else:
            raise ValueError("Brak ścieżki bazowej dla danych daily.")

    existing = _load_existing_daily(daily_canonical)

    if (not args.refresh) and len(existing) > 0:
        # jeśli config ma sztywny zakres, dofetchuj tylko brak końcówki
        last_date = pd.to_datetime(existing["date"].max()).date()
        fetch_start = max(start, last_date + timedelta(days=1))

        if fetch_start > end:
            log.info("No new daily data to fetch (already up to date).")
            daily_df = existing.copy()

            # jeśli obecny plik ma szerszy zakres niż config, przytnij do configowego
            daily_df = daily_df[
                (pd.to_datetime(daily_df["date"]).dt.date >= start)
                & (pd.to_datetime(daily_df["date"]).dt.date <= end)
            ].reset_index(drop=True)
        else:
            log.info(f"Incremental fetch from {fetch_start.isoformat()}..{end.isoformat()}")
            new_rows = _fetch_range(table, currency, fetch_start, end)
            new_df = pd.DataFrame(new_rows, columns=["date", "value"])
            daily_df = pd.concat([existing, new_df], ignore_index=True)
            daily_df = daily_df.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
            daily_df = daily_df[
                (pd.to_datetime(daily_df["date"]).dt.date >= start)
                & (pd.to_datetime(daily_df["date"]).dt.date <= end)
            ].reset_index(drop=True)
    else:
        log.info("Full fetch (refresh or empty file).")
        rows = _fetch_range(table, currency, start, end)
        daily_df = pd.DataFrame(rows, columns=["date", "value"]).sort_values("date").reset_index(drop=True)

    _save_daily(daily_canonical, daily_df)

    # dodatkowy snapshot / latest alias
    if daily_secondary is not None:
        _save_daily(daily_secondary, daily_df)

    data_dir = get_data_dir(cfg) if cfg is not None else daily_canonical.parent
    latest_daily = data_dir / f"raw_{pair}.csv"
    if latest_daily != daily_canonical and latest_daily != daily_secondary:
        _save_daily(latest_daily, daily_df)

    # kompatybilność ze starszym backendem/frontendem
    legacy_daily = data_dir / f"{currency.lower()}_a.csv"
    if legacy_daily != daily_canonical and legacy_daily != daily_secondary:
        _save_daily(legacy_daily, daily_df)

    if run_dir is not None:
        run_daily = get_run_data_dir(run_dir, cfg) / f"raw_{pair}.csv"
        if run_daily != daily_canonical and run_daily != daily_secondary:
            _save_daily(run_daily, daily_df)

    if args.freq == "daily":
        log.info("DONE fetch daily")
        return

    # -----------------------------------------------------
    # Hourly derived
    # -----------------------------------------------------
    if args.hourly_provider != "derived":
        raise ValueError("Only hourly-provider=derived is supported right now.")

    log.info(f"Build hourly (derived) | fill_weekends={args.fill_weekends}")
    hourly_df = _daily_to_hourly_derived(daily_df, fill_weekends=args.fill_weekends)

    out = hourly_df.copy()
    out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%dT%H:%M:%S")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    log.info(f"Saved {out_path} rows={len(out)}")

    if secondary_out is not None and secondary_out != out_path:
        secondary_out.parent.mkdir(parents=True, exist_ok=True)
        out.to_csv(secondary_out, index=False)
        log.info(f"Saved {secondary_out} rows={len(out)}")

    data_dir = get_data_dir(cfg) if cfg is not None else out_path.parent
    latest_hourly = data_dir / f"raw_{pair}_hourly.csv"
    if latest_hourly != out_path and latest_hourly != secondary_out:
        out.to_csv(latest_hourly, index=False)

    if run_dir is not None:
        run_hourly = get_run_data_dir(run_dir, cfg) / f"raw_{pair}_hourly.csv"
        if run_hourly != out_path and run_hourly != secondary_out:
            run_hourly.parent.mkdir(parents=True, exist_ok=True)
            out.to_csv(run_hourly, index=False)

    log.info("DONE fetch hourly derived")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.getLogger("fetch_nbp").exception("FAILED fetch_nbp")
        raise