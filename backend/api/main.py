from __future__ import annotations

import json
import mimetypes
import subprocess
import sys
import threading
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

# =========================
# Paths
# =========================
THIS_DIR = Path(__file__).resolve().parent


def _find_project_root(start: Path) -> Path:
    for c in [start, start.parent, start.parent.parent]:
        if (c / "data").exists() or (c / "results").exists() or (c / "package.json").exists():
            return c
    return start.parent


PROJECT_ROOT = _find_project_root(THIS_DIR)
DATA_DIR = PROJECT_ROOT / "data"
RESULTS_DIR = PROJECT_ROOT / "results"

# ważne: skrypty są w folderze backend/
FETCH_PY = THIS_DIR / "fetch_nbp.py"
TRAIN_PY = THIS_DIR / "train_eval.py"

DATA_CSV_DAILY = DATA_DIR / "eur_a.csv"
DATA_CSV_HOURLY = DATA_DIR / "eur_a_hourly.csv"

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
# Request models
# =========================
class FetchReq(BaseModel):
    years: int = Field(default=5, ge=1, le=30)
    refresh: bool = False

    # future-ready (NBP hourly is derived)
    freq: str = Field(default="daily", pattern="^(daily|hourly)$")
    hourlyProvider: str = Field(default="derived", pattern="^(derived)$")
    fillWeekends: bool = False

    logLevel: str = Field(default="INFO")


class TrainReq(BaseModel):
    noTuning: bool = True

    testSizeSamples: int = Field(default=260, ge=50, le=5000)
    valSizeSamples: int = Field(default=130, ge=0, le=5000)

    zoomWindowDays: int = Field(default=90, ge=7, le=365)

    # New horizons (business days)
    forecastDays7: int = Field(default=7, ge=1, le=60)
    forecastDays30: int = Field(default=22, ge=5, le=120)
    forecastDays90: int = Field(default=65, ge=10, le=260)
    forecastDays180: int = Field(default=130, ge=20, le=520)
    forecastDays365: int = Field(default=260, ge=60, le=1040)

    # backward compatible fields used by older UI
    forecastDays1m: Optional[int] = Field(default=None, ge=5, le=120)
    forecastDays12m: Optional[int] = Field(default=None, ge=60, le=1040)

    backtestWindows: int = Field(default=5, ge=3, le=20)

    # train on daily by default (hourly is optional future plan)
    dataFreq: str = Field(default="daily", pattern="^(daily|hourly)$")

    logLevel: str = Field(default="INFO")


class RunReq(FetchReq, TrainReq):
    pass


# =========================
# App
# =========================
app = FastAPI(title="EUR/PLN Tracker API", version="1.3")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# Logging helpers
# =========================
def _reset_log() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with _LOG_LOCK:
        RUN_LOG.write_text("", encoding="utf-8")


def _log(line: str) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%H:%M:%S")
    with _LOG_LOCK:
        with RUN_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{ts} | {line}\n")


def _read_log_text() -> str:
    if not RUN_LOG.exists():
        return ""
    return RUN_LOG.read_text(encoding="utf-8", errors="replace")


def _run_stream(cmd: list[str]) -> None:
    """Runs command, streams stdout/stderr into results/run.log."""
    _log(f"RUN: {' '.join(cmd)}")

    p = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert p.stdout is not None
    for line in p.stdout:
        _log(line.rstrip("\n"))

    rc = p.wait()
    if rc != 0:
        raise RuntimeError(f"Command failed (code={rc}): {' '.join(cmd)}")


def _run(cmd: list[str]) -> str:
    _run_stream(cmd)
    return _read_log_text()


# =========================
# JSON-safe helpers
# =========================
def _json_safe(obj: Any):
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]

    try:
        if pd.isna(obj):
            return None
    except Exception:
        pass

    return obj


# =========================
# Data helpers
# =========================
def _data_csv_for_freq(freq: str) -> Path:
    return DATA_CSV_DAILY if freq == "daily" else DATA_CSV_HOURLY


def _last_rate() -> Optional[dict]:
    """Last rate is always taken from DAILY."""
    if not DATA_CSV_DAILY.exists():
        return None
    df = pd.read_csv(DATA_CSV_DAILY, parse_dates=["date"]).sort_values("date")
    if df.empty:
        return None

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last

    value = float(last["value"])
    prevv = float(prev["value"])
    delta = value - prevv

    return {
        "date": str(pd.to_datetime(last["date"]).date()),
        "value": value,
        "prevValue": prevv,
        "delta": delta,
        "deltaPct": (delta / prevv * 100.0) if prevv else 0.0,
    }


def _read_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return _json_safe(data)
    except Exception:
        return None


def _read_metrics() -> Optional[dict]:
    return _read_json(RESULTS_DIR / "metrics.json")


def _read_run_config() -> Optional[dict]:
    return _read_json(RESULTS_DIR / "run_config.json")


def _read_backtest() -> Optional[dict]:
    return _read_json(RESULTS_DIR / "backtest.json")


def _read_forecast_csv(filename: str) -> list[dict]:
    p = RESULTS_DIR / filename
    if not p.exists():
        return []
    df = pd.read_csv(p)
    df = df.astype(object).where(pd.notna(df), None)
    return _json_safe(df.to_dict(orient="records"))


# =========================
# Endpoints
# =========================
@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


@app.post("/api/fetch")
def api_fetch(req: FetchReq):
    _reset_log()
    RUN_STATE.update(running=True, stage="fetch", error=None, startedAt=datetime.utcnow().isoformat(), finishedAt=None)
    _log(f"START /api/fetch payload={req.model_dump()}")

    try:
        if not FETCH_PY.exists():
            raise HTTPException(status_code=500, detail=f"Missing fetch script: {FETCH_PY}")

        out_csv = _data_csv_for_freq(req.freq)

        cmd = [
            sys.executable, "-u", str(FETCH_PY),
            "--years", str(req.years),
            "--out", str(out_csv),
            "--freq", req.freq,
            "--log-level", req.logLevel,
        ]
        if req.refresh:
            cmd.append("--refresh")
        if req.freq == "hourly":
            cmd += ["--hourly-provider", req.hourlyProvider]
            if req.fillWeekends:
                cmd.append("--fill-weekends")

        logs = _run(cmd)
        _log("DONE /api/fetch OK")

        return _json_safe({
            "ok": True,
            "logs": logs,
            "lastRate": _last_rate(),
            "updatedAt": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        RUN_STATE["error"] = str(e)
        _log(f"ERROR: {e}")
        raise
    finally:
        RUN_STATE.update(running=False, stage=None, finishedAt=datetime.utcnow().isoformat())


@app.post("/api/train")
def api_train(req: TrainReq):
    _reset_log()
    RUN_STATE.update(running=True, stage="train", error=None, startedAt=datetime.utcnow().isoformat(), finishedAt=None)
    _log(f"START /api/train payload={req.model_dump()}")

    try:
        if not TRAIN_PY.exists():
            raise HTTPException(status_code=500, detail=f"Missing train script: {TRAIN_PY}")

        RESULTS_DIR.mkdir(parents=True, exist_ok=True)

        data_csv = _data_csv_for_freq(req.dataFreq)
        if not data_csv.exists():
            raise HTTPException(status_code=404, detail=f"No data yet for freq={req.dataFreq}. Run fetch first.")

        f30 = req.forecastDays30 if req.forecastDays30 is not None else (req.forecastDays1m or 22)
        f365 = req.forecastDays365 if req.forecastDays365 is not None else (req.forecastDays12m or 260)

        cmd = [
            sys.executable, "-u", str(TRAIN_PY),
            "--data", str(data_csv),
            "--test-size-samples", str(req.testSizeSamples),
            "--val-size-samples", str(req.valSizeSamples),
            "--zoom-window-days", str(req.zoomWindowDays),

            "--forecast-days-7", str(req.forecastDays7),
            "--forecast-days-30", str(f30),
            "--forecast-days-90", str(req.forecastDays90),
            "--forecast-days-180", str(req.forecastDays180),
            "--forecast-days-365", str(f365),

            "--backtest-windows", str(req.backtestWindows),
            "--log-level", req.logLevel,
        ]
        if req.noTuning:
            cmd.append("--no-tuning")

        logs = _run(cmd)
        _log("DONE /api/train OK")

        return _json_safe({
            "ok": True,
            "logs": logs,
            "lastRate": _last_rate(),
            "runConfig": _read_run_config(),
            "metrics": _read_metrics(),
            "backtest": _read_backtest(),
            "forecast7": _read_forecast_csv("forecast_next7.csv"),
            "forecast30": _read_forecast_csv("forecast_next30.csv"),
            "forecast90": _read_forecast_csv("forecast_next90.csv"),
            "forecast180": _read_forecast_csv("forecast_next180.csv"),
            "forecast365": _read_forecast_csv("forecast_next365.csv"),
            "forecast1m": _read_forecast_csv("forecast_next1m.csv"),
            "forecast12m": _read_forecast_csv("forecast_next12m.csv"),
            "updatedAt": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        RUN_STATE["error"] = str(e)
        _log(f"ERROR: {e}")
        raise
    finally:
        RUN_STATE.update(running=False, stage=None, finishedAt=datetime.utcnow().isoformat())


@app.post("/api/run")
def api_run(req: RunReq):
    _reset_log()
    RUN_STATE.update(running=True, stage="fetch", error=None, startedAt=datetime.utcnow().isoformat(), finishedAt=None)
    _log(f"START /api/run payload={req.model_dump()}")

    try:
        if not FETCH_PY.exists():
            raise HTTPException(status_code=500, detail=f"Missing fetch script: {FETCH_PY}")
        if not TRAIN_PY.exists():
            raise HTTPException(status_code=500, detail=f"Missing train script: {TRAIN_PY}")

        _log("STAGE fetch")
        out_csv = _data_csv_for_freq(req.freq)
        cmd_fetch = [
            sys.executable, "-u", str(FETCH_PY),
            "--years", str(req.years),
            "--out", str(out_csv),
            "--freq", req.freq,
            "--log-level", req.logLevel,
        ]
        if req.refresh:
            cmd_fetch.append("--refresh")
        if req.freq == "hourly":
            cmd_fetch += ["--hourly-provider", req.hourlyProvider]
            if req.fillWeekends:
                cmd_fetch.append("--fill-weekends")
        _run_stream(cmd_fetch)

        RUN_STATE["stage"] = "train"
        _log("STAGE train")

        data_csv = _data_csv_for_freq(req.dataFreq)
        if not data_csv.exists():
            raise HTTPException(status_code=404, detail=f"No data yet for dataFreq={req.dataFreq}. Run fetch first.")

        f30 = req.forecastDays30 if req.forecastDays30 is not None else (req.forecastDays1m or 22)
        f365 = req.forecastDays365 if req.forecastDays365 is not None else (req.forecastDays12m or 260)

        cmd_train = [
            sys.executable, "-u", str(TRAIN_PY),
            "--data", str(data_csv),
            "--test-size-samples", str(req.testSizeSamples),
            "--val-size-samples", str(req.valSizeSamples),
            "--zoom-window-days", str(req.zoomWindowDays),

            "--forecast-days-7", str(req.forecastDays7),
            "--forecast-days-30", str(f30),
            "--forecast-days-90", str(req.forecastDays90),
            "--forecast-days-180", str(req.forecastDays180),
            "--forecast-days-365", str(f365),

            "--backtest-windows", str(req.backtestWindows),
            "--log-level", req.logLevel,
        ]
        if req.noTuning:
            cmd_train.append("--no-tuning")

        _run_stream(cmd_train)

        logs = _read_log_text()
        _log("DONE /api/run OK")

        return _json_safe({
            "ok": True,
            "logs": logs,
            "lastRate": _last_rate(),
            "runConfig": _read_run_config(),
            "metrics": _read_metrics(),
            "backtest": _read_backtest(),
            "forecast7": _read_forecast_csv("forecast_next7.csv"),
            "forecast30": _read_forecast_csv("forecast_next30.csv"),
            "forecast90": _read_forecast_csv("forecast_next90.csv"),
            "forecast180": _read_forecast_csv("forecast_next180.csv"),
            "forecast365": _read_forecast_csv("forecast_next365.csv"),
            "forecast1m": _read_forecast_csv("forecast_next1m.csv"),
            "forecast12m": _read_forecast_csv("forecast_next12m.csv"),
            "updatedAt": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        RUN_STATE["error"] = str(e)
        _log(f"ERROR: {e}")
        raise
    finally:
        RUN_STATE.update(running=False, stage=None, finishedAt=datetime.utcnow().isoformat())


@app.get("/api/results")
def api_results():
    return _json_safe({
        "lastRate": _last_rate(),
        "runConfig": _read_run_config(),
        "metrics": _read_metrics(),
        "backtest": _read_backtest(),
        "forecast7": _read_forecast_csv("forecast_next7.csv"),
        "forecast30": _read_forecast_csv("forecast_next30.csv"),
        "forecast90": _read_forecast_csv("forecast_next90.csv"),
        "forecast180": _read_forecast_csv("forecast_next180.csv"),
        "forecast365": _read_forecast_csv("forecast_next365.csv"),
        "forecast1m": _read_forecast_csv("forecast_next1m.csv"),
        "forecast12m": _read_forecast_csv("forecast_next12m.csv"),
        "updatedAt": datetime.utcnow().isoformat(),
    })


@app.get("/api/series")
def api_series(days: int = 365, freq: str = "daily"):
    csv = _data_csv_for_freq(freq)
    if not csv.exists():
        return {"series": []}
    df = pd.read_csv(csv, parse_dates=["date"]).sort_values("date")
    df = df.tail(days) if days > 0 else df
    return {
        "series": [
            {"date": pd.to_datetime(d).isoformat(), "value": float(v)}
            for d, v in zip(df["date"], df["value"])
        ]
    }


@app.get("/api/data")
def api_data(limit: int = 500, freq: str = "daily"):
    csv = _data_csv_for_freq(freq)
    if not csv.exists():
        return {"rows": []}
    df = pd.read_csv(csv, parse_dates=["date"]).sort_values("date").tail(limit)
    return {
        "rows": [
            {"date": pd.to_datetime(d).isoformat(), "value": float(v)}
            for d, v in zip(df["date"], df["value"])
        ]
    }


@app.get("/api/export/data.xlsx")
def api_export_data_xlsx(limit: int = 500, freq: str = "daily"):
    csv = _data_csv_for_freq(freq)
    if not csv.exists():
        raise HTTPException(status_code=404, detail="No data yet. Run fetch.")

    limit = max(1, min(int(limit), 20000))
    df = pd.read_csv(csv, parse_dates=["date"]).sort_values("date").tail(limit)

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = f"EURPLN_{freq}"
    ws.append(["date", "value"])
    for d, v in zip(df["date"], df["value"]):
        ws.append([pd.to_datetime(d).isoformat(), float(v)])

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    headers = {"Content-Disposition": f"attachment; filename=eurpln_{freq}.xlsx"}
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
    return FileResponse(
        p,
        media_type=media_type or "application/octet-stream",
        filename=p.name,
    )


@app.get("/api/logs")
def api_logs(offset: int = 0):
    txt = _read_log_text()
    offset = max(0, int(offset))
    if offset > len(txt):
        offset = 0
    chunk = txt[offset:]
    return _json_safe({
        "text": chunk,
        "nextOffset": offset + len(chunk),
        "state": RUN_STATE,
    })