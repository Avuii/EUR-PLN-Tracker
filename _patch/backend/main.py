from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
from io import BytesIO
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

# =========================
# ŚCIEŻKI / PLIKI
# =========================
BACKEND_DIR = Path(__file__).resolve().parent
# Wspieramy 2 układy projektu:
# 1) repo/<backend>/main.py  -> PROJECT_ROOT = repo/
# 2) repo/main.py (backend w root) -> PROJECT_ROOT = repo/
PROJECT_ROOT = BACKEND_DIR.parent
if (BACKEND_DIR / "data").exists() or (BACKEND_DIR / "results").exists():
    PROJECT_ROOT = BACKEND_DIR

FETCH_PY = BACKEND_DIR / "fetch_nbp.py"
TRAIN_PY = BACKEND_DIR / "train_eval.py"

DATA_DIR = PROJECT_ROOT / "data"
RESULTS_DIR = PROJECT_ROOT / "results"
DATA_CSV = DATA_DIR / "eur_a.csv"

RUN_LOG = RESULTS_DIR / "run.log"
_LOG_LOCK = threading.Lock()

RUN_STATE = {
    "running": False,
    "stage": None,  # "fetch" | "train" | None
    "error": None,
    "startedAt": None,
    "finishedAt": None,
}

# =========================
# MODELE REQUESTÓW
# =========================
class FetchReq(BaseModel):
    years: int = Field(default=5, ge=1, le=30)
    refresh: bool = False


class TrainReq(BaseModel):
    noTuning: bool = True
    testSizeSamples: int = Field(default=260, ge=50, le=2000)
    zoomWindowDays: int = Field(default=90, ge=7, le=365)
    forecastDays7: int = Field(default=7, ge=1, le=60)
    forecastDays1m: int = Field(default=22, ge=5, le=90)
    forecastDays12m: int = Field(default=260, ge=60, le=520)


class RunReq(FetchReq, TrainReq):
    pass


# =========================
# APP
# =========================
app = FastAPI()

_cors_raw = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:4000,http://localhost:5173")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# LOGOWANIE (run.log)
# =========================
def _reset_log() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    RUN_LOG.write_text("", encoding="utf-8")


def _log(line: str) -> None:
    ts = datetime.utcnow().strftime("%H:%M:%S")
    msg = f"[{ts}] {line}\n"
    with _LOG_LOCK:
        RUN_LOG.parent.mkdir(parents=True, exist_ok=True)
        with RUN_LOG.open("a", encoding="utf-8") as f:
            f.write(msg)


def _run_stream(cmd: list[str]) -> None:
    """
    Uruchamia proces i dopisuje stdout/stderr linia-po-linii do results/run.log
    """
    _log("$ " + " ".join(cmd))

    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"}

    p = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )

    assert p.stdout is not None
    for line in p.stdout:
        _log(line.rstrip("\n"))

    rc = p.wait()
    if rc != 0:
        raise RuntimeError(f"Command failed (code={rc}): {' '.join(cmd)}")


def _run(cmd: list[str]) -> str:
    """
    Kompatybilność dla endpointów /api/fetch i /api/train:
    uruchamia przez _run_stream i zwraca aktualną zawartość run.log
    """
    _run_stream(cmd)
    return RUN_LOG.read_text(encoding="utf-8") if RUN_LOG.exists() else ""


# =========================
# HELPERY DANYCH
# =========================
def _last_rate() -> Optional[dict]:
    if not DATA_CSV.exists():
        return None
    df = pd.read_csv(DATA_CSV, parse_dates=["date"]).sort_values("date")
    if df.empty:
        return None

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last

    value = float(last["value"])
    prevv = float(prev["value"])
    delta = value - prevv
    pct = (delta / prevv * 100.0) if prevv != 0 else 0.0

    return {
        "pair": "EUR/PLN",
        "date": str(pd.to_datetime(last["date"]).date()),
        "value": value,
        "dailyChange": delta,
        "dailyChangePct": pct,
    }


def _read_metrics() -> dict:
    p = RESULTS_DIR / "metrics.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _read_forecast_csv(name: str) -> list[dict]:
    p = RESULTS_DIR / name
    if not p.exists():
        return []
    return pd.read_csv(p).to_dict(orient="records")


# =========================
# ENDPOINTY
# =========================
@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


@app.post("/api/fetch")
def api_fetch(req: FetchReq):
    _reset_log()
    RUN_STATE.update(
        running=True,
        stage="fetch",
        error=None,
        startedAt=datetime.utcnow().isoformat(),
        finishedAt=None,
    )
    _log(f"START /api/fetch payload={req.model_dump()}")

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cmd = [sys.executable, "-u", str(FETCH_PY), "--years", str(req.years), "--out", str(DATA_CSV)]
        if req.refresh:
            cmd.append("--refresh")

        logs = _run(cmd)

        _log("DONE /api/fetch OK")
        return {"ok": True, "logs": logs, "lastRate": _last_rate(), "updatedAt": datetime.utcnow().isoformat()}

    except Exception as e:
        RUN_STATE["error"] = str(e)
        _log(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        RUN_STATE.update(running=False, stage=None, finishedAt=datetime.utcnow().isoformat())


@app.post("/api/train")
def api_train(req: TrainReq):
    _reset_log()
    RUN_STATE.update(
        running=True,
        stage="train",
        error=None,
        startedAt=datetime.utcnow().isoformat(),
        finishedAt=None,
    )
    _log(f"START /api/train payload={req.model_dump()}")

    try:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable, "-u", str(TRAIN_PY),
            "--test-size-samples", str(req.testSizeSamples),
            "--zoom-window-days", str(req.zoomWindowDays),
            "--forecast-days-7", str(req.forecastDays7),
            "--forecast-days-1m", str(req.forecastDays1m),
            "--forecast-days-12m", str(req.forecastDays12m),
        ]
        if req.noTuning:
            cmd.append("--no-tuning")

        logs = _run(cmd)

        _log("DONE /api/train OK")
        return {
            "ok": True,
            "logs": logs,
            "lastRate": _last_rate(),
            "metrics": _read_metrics(),
            "forecast7": _read_forecast_csv("forecast_next7.csv"),
            "forecast1m": _read_forecast_csv("forecast_next1m.csv"),
            "forecast12m": _read_forecast_csv("forecast_next12m.csv"),
            "updatedAt": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        RUN_STATE["error"] = str(e)
        _log(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        RUN_STATE.update(running=False, stage=None, finishedAt=datetime.utcnow().isoformat())


@app.post("/api/run")
def api_run(req: RunReq):
    _reset_log()
    RUN_STATE.update(
        running=True,
        stage="fetch",
        error=None,
        startedAt=datetime.utcnow().isoformat(),
        finishedAt=None,
    )
    _log(f"START /api/run payload={req.model_dump()}")

    try:
        # 1) fetch
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cmd_fetch = [sys.executable, "-u", str(FETCH_PY), "--years", str(req.years), "--out", str(DATA_CSV)]
        if req.refresh:
            cmd_fetch.append("--refresh")
        _run_stream(cmd_fetch)

        # 2) train
        RUN_STATE["stage"] = "train"
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        cmd_train = [
            sys.executable, "-u", str(TRAIN_PY),
            "--test-size-samples", str(req.testSizeSamples),
            "--zoom-window-days", str(req.zoomWindowDays),
            "--forecast-days-7", str(req.forecastDays7),
            "--forecast-days-1m", str(req.forecastDays1m),
            "--forecast-days-12m", str(req.forecastDays12m),
        ]
        if req.noTuning:
            cmd_train.append("--no-tuning")
        _run_stream(cmd_train)

        _log("DONE /api/run OK")

        return {
            "ok": True,
            "logs": RUN_LOG.read_text(encoding="utf-8") if RUN_LOG.exists() else "",
            "lastRate": _last_rate(),
            "metrics": _read_metrics(),
            "forecast7": _read_forecast_csv("forecast_next7.csv"),
            "forecast1m": _read_forecast_csv("forecast_next1m.csv"),
            "forecast12m": _read_forecast_csv("forecast_next12m.csv"),
            "updatedAt": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        RUN_STATE["error"] = str(e)
        _log(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        RUN_STATE.update(running=False, stage=None, finishedAt=datetime.utcnow().isoformat())


@app.get("/api/results")
def api_results():
    return {
        "lastRate": _last_rate(),
        "metrics": _read_metrics(),
        "forecast7": _read_forecast_csv("forecast_next7.csv"),
        "updatedAt": datetime.utcnow().isoformat(),
    }


@app.get("/api/series")
def api_series(days: int = 365):
    if not DATA_CSV.exists():
        return {"series": []}
    df = pd.read_csv(DATA_CSV, parse_dates=["date"]).sort_values("date")
    df = df.tail(days) if days > 0 else df
    return {"series": [{"date": str(d.date()), "value": float(v)} for d, v in zip(df["date"], df["value"])]}


@app.get("/api/data")
def api_data(limit: int = 500):
    if not DATA_CSV.exists():
        return {"rows": []}
    df = pd.read_csv(DATA_CSV, parse_dates=["date"]).sort_values("date").tail(limit)
    return {"rows": [{"date": str(d.date()), "value": float(v)} for d, v in zip(df["date"], df["value"])]}


@app.get("/api/export/data.xlsx")
def api_export_data_xlsx(limit: int = 500):
    """Eksport ostatnich `limit` rekordów do Excela (XLSX)."""
    if not DATA_CSV.exists():
        raise HTTPException(status_code=404, detail="No data yet. Run fetch.")

    limit = max(1, min(int(limit), 20000))
    df = pd.read_csv(DATA_CSV, parse_dates=["date"]).sort_values("date").tail(limit)

    try:
        from openpyxl import Workbook
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"openpyxl missing: {e}")

    wb = Workbook()
    ws = wb.active
    ws.title = "EURPLN"
    ws.append(["date", "value"])
    for d, v in zip(df["date"], df["value"]):
        ws.append([str(pd.to_datetime(d).date()), float(v)])

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    headers = {"Content-Disposition": "attachment; filename=eurpln_data.xlsx"}
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.get("/api/artifacts/{filename}")
def api_artifacts(filename: str):
    p = (RESULTS_DIR / filename).resolve()
    if not str(p).startswith(str(RESULTS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")

    if not p.exists():
        raise HTTPException(status_code=404, detail="Not found")

    media_type, _ = mimetypes.guess_type(str(p))
    return FileResponse(p, media_type=media_type or "application/octet-stream")


@app.get("/api/logs")
def api_logs(offset: int = 0):

    if not RUN_LOG.exists():
        return {"chunk": "", "nextOffset": offset, **RUN_STATE}

    with RUN_LOG.open("rb") as f:
        f.seek(max(0, offset))
        chunk = f.read()
        next_offset = f.tell()

    return {
        "chunk": chunk.decode("utf-8", errors="replace"),
        "nextOffset": next_offset,
        **RUN_STATE,
    }
