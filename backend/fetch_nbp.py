from __future__ import annotations
import os
import argparse
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

TABLE = "A"
CURRENCY = "EUR"
BASE = "https://api.nbp.pl/api/exchangerates/rates"
FMT = "json"
MAX_DAYS_PER_REQ = 360  # bezpiecznie poniżej limitu NBP (~367)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "eur_a.csv"


def _url(table: str, code: str, start: date, end: date) -> str:
    return f"{BASE}/{table}/{code}/{start.isoformat()}/{end.isoformat()}/?format={FMT}"


def _get_last_available(table: str, code: str) -> tuple[date, float]:
    # last/1 działa niezależnie od weekendów — zwraca ostatni dostępny kurs
    url = f"{BASE}/{table}/{code}/last/1/?format={FMT}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    js = r.json()
    last = js["rates"][0]
    d = pd.to_datetime(last["effectiveDate"]).date()
    v = float(last["mid"])
    return d, v


def _fetch_range(table: str, code: str, start: date, end: date) -> pd.DataFrame:
    """
    Pobiera zakres. Jeśli NBP zwróci 404 'Brak danych' (np. cały zakres to weekend),
    zwraca pusty DF.
    """
    url = _url(table, code, start, end)
    r = requests.get(url, timeout=60)
    if r.status_code == 404:
        return pd.DataFrame(columns=["date", "value"])
    r.raise_for_status()
    js = r.json()

    rows = [{"date": it["effectiveDate"], "value": float(it["mid"])} for it in js.get("rates", [])]
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    return df


def fetch_range_chunked(table: str, code: str, start: date, end: date) -> pd.DataFrame:
    out: list[pd.DataFrame] = []
    cur = start
    while cur <= end:
        chunk_end = min(end, cur + timedelta(days=MAX_DAYS_PER_REQ))
        part = _fetch_range(table, code, cur, chunk_end)
        if not part.empty:
            out.append(part)
        cur = chunk_end + timedelta(days=1)

    if not out:
        return pd.DataFrame(columns=["date", "value"])

    df = pd.concat(out, ignore_index=True)
    df = df.sort_values("date").drop_duplicates("date").reset_index(drop=True)
    return df


def update_csv(out_path: Path, years: int = 5, refresh: bool = False) -> pd.DataFrame:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 1) OFFLINE: jeśli nie odświeżasz, to tylko czytamy plik i ewentualnie przycinamy zakres
    if not refresh:
        if not out_path.exists():
            raise FileNotFoundError(
                f"Brak pliku {out_path}. Uruchom raz z --refresh, żeby pobrać dane z NBP."
            )

        old = pd.read_csv(out_path, parse_dates=["date"])
        if old.empty:
            return old

        old = old.sort_values("date").drop_duplicates("date").reset_index(drop=True)

        last_date = pd.to_datetime(old["date"].iloc[-1]).date()
        cutoff = last_date - timedelta(days=365 * years)
        old = old[old["date"] >= pd.Timestamp(cutoff)].reset_index(drop=True)

        return old

    # 2) ONLINE (refresh=True): pobieramy z NBP i aktualizujemy plik
    end_date, _ = _get_last_available(TABLE, CURRENCY)
    start_date = end_date - timedelta(days=365 * years)

    old = pd.DataFrame(columns=["date", "value"])
    if out_path.exists():
        old = pd.read_csv(out_path, parse_dates=["date"])
        if not old.empty:
            old = old.sort_values("date").drop_duplicates("date").reset_index(drop=True)

    # jeżeli mamy stare dane, dociągamy tylko brakujący ogon
    fetch_start = start_date
    if not old.empty:
        last_old = pd.to_datetime(old["date"].iloc[-1]).date()
        fetch_start = max(start_date, last_old + timedelta(days=1))

    new = pd.DataFrame(columns=["date", "value"])
    if fetch_start <= end_date:
        new = fetch_range_chunked(TABLE, CURRENCY, fetch_start, end_date)

    if old.empty and new.empty:
        raise RuntimeError("Nie udało się pobrać żadnych danych z NBP.")

    if old.empty:
        merged = new.copy()
    elif new.empty:
        merged = old.copy()
    else:
        merged = pd.concat([old, new], ignore_index=True)

    merged = merged.sort_values("date").drop_duplicates("date").reset_index(drop=True)

    # przycinamy do ostatnich N lat
    cutoff = end_date - timedelta(days=365 * years)
    merged = merged[merged["date"] >= pd.Timestamp(cutoff)].reset_index(drop=True)

    merged.to_csv(out_path, index=False)
    return merged


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--out", type=str, default=str(DEFAULT_OUT))
    args = ap.parse_args()

    out_path = Path(args.out)
    df = update_csv(out_path, years=args.years, refresh=args.refresh)
    last_date = pd.to_datetime(df["date"].iloc[-1]).date() if not df.empty else None
    print(f"DONE -> {out_path} (rows={len(df)}), last_date={last_date}")


if __name__ == "__main__":
    main()
