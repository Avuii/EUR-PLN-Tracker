import argparse
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import List, Tuple

import pandas as pd
import requests

TABLE = "A"
CURRENCY = "EUR"
BASE = "https://api.nbp.pl/api/exchangerates/rates"
FMT = "json"

# bezpiecznie poniżej limitu NBP (~367)
MAX_DAYS_PER_REQ = 360

log = logging.getLogger("fetch")


def setup_logging(level: str) -> None:
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )


def _url(table: str, code: str, start: date, end: date) -> str:
    return f"{BASE}/{table}/{code}/{start.isoformat()}/{end.isoformat()}/?format={FMT}"


def _fetch_range(table: str, code: str, start: date, end: date) -> List[Tuple[date, float]]:
    """
    Fetch daily NBP rates (Table A) for date range [start, end] in chunks.

    Ważne:
    - NBP potrafi zwrócić 404 dla zakresu bez notowań (np. sam weekend / święta)
    - wtedy nie traktujemy tego jako błąd krytyczny, tylko pomijamy chunk
    """
    if start > end:
        return []

    out: List[Tuple[date, float]] = []
    cur = start

    with requests.Session() as session:
        while cur <= end:
            chunk_end = min(end, cur + timedelta(days=MAX_DAYS_PER_REQ - 1))
            url = _url(table, code, cur, chunk_end)
            log.info(f"GET {cur.isoformat()}..{chunk_end.isoformat()}")

            try:
                r = session.get(url, timeout=30)

                if r.status_code == 404:
                    log.warning(
                        f"No NBP data for range {cur.isoformat()}..{chunk_end.isoformat()} "
                        f"(weekend/holiday/empty range) — skipping."
                    )
                    cur = chunk_end + timedelta(days=1)
                    continue

                r.raise_for_status()
                js = r.json()
                rates = js.get("rates", [])

                for it in rates:
                    d = date.fromisoformat(it["effectiveDate"])
                    v = float(it["mid"])
                    out.append((d, v))

            except requests.RequestException as e:
                log.exception(f"HTTP error for range {cur.isoformat()}..{chunk_end.isoformat()}: {e}")
                raise

            cur = chunk_end + timedelta(days=1)

    return out


def _load_existing_daily(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["date", "value"])

    df = pd.read_csv(path, parse_dates=["date"])
    if df.empty:
        return pd.DataFrame(columns=["date", "value"])

    df = df.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    df["value"] = df["value"].astype(float)
    return df


def _save_daily(path: Path, df: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = df.copy()
    out["date"] = pd.to_datetime(out["date"]).dt.date.astype(str)
    out.to_csv(path, index=False)
    log.info(f"Saved {path} rows={len(out)}")


def _daily_to_hourly_derived(
    daily_df: pd.DataFrame,
    fill_weekends: bool,
) -> pd.DataFrame:
    """
    Create hourly series derived from daily:
    - If fill_weekends: reindex to all calendar days and forward-fill values, then expand to hours
    - Else: expand only existing business-day rows to 24 hours each

    Output columns: date (datetime ISO), value
    """
    if daily_df.empty:
        return pd.DataFrame(columns=["date", "value"])

    d = daily_df.copy()
    d["date"] = pd.to_datetime(d["date"]).dt.normalize()
    d = d.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)

    if fill_weekends:
        full_days = pd.date_range(d["date"].min(), d["date"].max(), freq="D")
        d = d.set_index("date").reindex(full_days).ffill().reset_index()
        d = d.rename(columns={"index": "date"})

    rows = []
    for dt, val in zip(d["date"], d["value"]):
        base = pd.to_datetime(dt)
        for h in range(24):
            rows.append(
                {
                    "date": base + pd.Timedelta(hours=h),
                    "value": float(val),
                }
            )

    return pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--out", type=str, required=True)
    ap.add_argument("--freq", type=str, default="daily", choices=["daily", "hourly"])
    ap.add_argument("--hourly-provider", type=str, default="derived", choices=["derived"])
    ap.add_argument("--fill-weekends", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--log-level", type=str, default="INFO")
    args = ap.parse_args()

    setup_logging(args.log_level)
    out_path = Path(args.out)

    today = date.today()
    start = today - timedelta(days=int(args.years * 365.25))
    end = today

    log.info(f"START fetch | freq={args.freq} years={args.years} refresh={args.refresh}")
    log.info(f"Range approx: {start.isoformat()}..{end.isoformat()}")

    # zawsze budujemy / odświeżamy DAILY base first
    daily_out = out_path if args.freq == "daily" else out_path.parent / "eur_a.csv"

    existing = _load_existing_daily(daily_out)

    if (not args.refresh) and len(existing) > 0:
        last_date = pd.to_datetime(existing["date"].max()).date()
        fetch_start = last_date + timedelta(days=1)

        if fetch_start > end:
            log.info("No new daily data to fetch (already up to date).")
            daily_df = existing
        else:
            log.info(f"Incremental fetch from {fetch_start.isoformat()}..{end.isoformat()}")
            new = _fetch_range(TABLE, CURRENCY, fetch_start, end)

            if len(new) == 0:
                log.info("No new rows returned by NBP. Keeping existing daily data.")
                daily_df = existing
            else:
                new_df = pd.DataFrame(new, columns=["date", "value"])
                daily_df = pd.concat([existing, new_df], ignore_index=True)
                daily_df = (
                    daily_df.sort_values("date")
                    .drop_duplicates(subset=["date"])
                    .reset_index(drop=True)
                )
    else:
        log.info("Full fetch (refresh or empty file).")
        rows = _fetch_range(TABLE, CURRENCY, start, end)

        if len(rows) == 0:
            log.warning("NBP returned no rows for requested full range.")
            daily_df = pd.DataFrame(columns=["date", "value"])
        else:
            daily_df = (
                pd.DataFrame(rows, columns=["date", "value"])
                .sort_values("date")
                .reset_index(drop=True)
            )

    _save_daily(daily_out, daily_df)

    if args.freq == "daily":
        log.info("DONE fetch daily")
        return

    if args.hourly_provider != "derived":
        raise ValueError("Only hourly-provider=derived is supported right now.")

    log.info(f"Build hourly (derived) | fill_weekends={args.fill_weekends}")
    hourly_df = _daily_to_hourly_derived(daily_df, fill_weekends=args.fill_weekends)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out = hourly_df.copy()
    if not out.empty:
        out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%dT%H:%M:%S")
    out.to_csv(out_path, index=False)

    log.info(f"Saved {out_path} rows={len(out)}")
    log.info("DONE fetch hourly derived")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.getLogger("fetch").exception("FAILED fetch")
        raise