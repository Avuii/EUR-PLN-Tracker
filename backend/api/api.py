from __future__ import annotations

import json
import math
import mimetypes
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from src.config import get_data_dir, get_run_data_dir, get_runs_dir, load_config, resolve_path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


# =========================================================
# Config + app
# =========================================================
cfg = load_config()
app = FastAPI(title="EUR/PLN Tracker API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.get("api", {}).get("cors_origins", [
        "http://localhost:4000",
        "http://127.0.0.1:4000",
    ]),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Request models
# =========================================================
class RunReq(BaseModel):
    config: str = "configs/config.json"
    skip_fetch: bool = False
    skip_build: bool = False
    skip_train: bool = False
    no_tuning: bool = False
    val_size_samples: Optional[int] = None
    test_size_samples: Optional[int] = None
    backtest_windows: Optional[int] = None


# =========================================================
# Helpers
# =========================================================
def _json_load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _find_run_dirs() -> list[Path]:
    runs_dir = get_runs_dir(cfg)
    runs_dir.mkdir(parents=True, exist_ok=True)
    return sorted(
        [p for p in runs_dir.iterdir() if p.is_dir()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )




def _run_data_dir(run_path: Path) -> Path:
    return get_run_data_dir(run_path, cfg)


def _run_file(run_path: Path, filename: str) -> Path:
    candidates = [
        _run_data_dir(run_path) / filename,
        run_path / filename,
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


def _json_safe(value: Any) -> Any:
    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    return value


def _df_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    clean = df.copy()
    clean = clean.replace([float("inf"), float("-inf")], pd.NA)
    clean = clean.astype(object).where(pd.notna(clean), None)
    return _json_safe(clean.to_dict(orient="records"))


def _has_artifacts(run_path: Path) -> bool:
    run_data_dir = _run_data_dir(run_path)
    has_metrics = (run_path / "metrics.json").exists()
    has_forecast = (run_data_dir / "forecast_points.csv").exists() or (run_path / "forecast_points.csv").exists()
    has_predictions = any(run_data_dir.glob("predictions_H*.csv")) or any(run_path.glob("predictions_H*.csv"))
    return has_metrics and has_forecast and has_predictions


def _is_ok_run(run_path: Path) -> bool:
    status_path = run_path / "pipeline_status.json"

    if status_path.exists():
        try:
            status = _json_load(status_path)
            if status.get("status") == "failed":
                return False
        except Exception:
            pass

    return _has_artifacts(run_path)


def _latest_any_run() -> Path:
    runs = _find_run_dirs()
    if not runs:
        raise HTTPException(status_code=404, detail="Brak uruchomień pipeline.")
    return runs[0]


def _latest_run() -> Path:
    runs = _find_run_dirs()

    if not runs:
        raise HTTPException(status_code=404, detail="Brak uruchomień pipeline.")

    for run_path in runs:
        if _is_ok_run(run_path):
            return run_path

    raise HTTPException(
        status_code=404,
        detail="Brak udanego runa z plikami metrics.json oraz CSV w run/data.",
    )


def _resolve_run(run: str | None) -> Path:
    if not run:
        return _latest_run()
    p = resolve_path(run)
    if p.exists() and p.is_dir():
        return p

    # jeśli user poda tylko nazwę folderu runa
    cand = get_runs_dir(cfg) / run
    if cand.exists() and cand.is_dir():
        return cand

    raise HTTPException(status_code=404, detail=f"Nie znaleziono run_dir: {run}")


def _run_json(run_path: Path, filename: str, required: bool = True) -> Any:
    p = run_path / filename
    if not p.exists():
        if required:
            raise HTTPException(status_code=404, detail=f"Brak pliku {filename} w {run_path.name}")
        return None
    return _json_load(p)


def _run_csv(run_path: Path, filename: str, required: bool = True) -> pd.DataFrame:
    p = _run_file(run_path, filename)
    if not p.exists():
        if required:
            raise HTTPException(status_code=404, detail=f"Brak pliku {filename} w {run_path.name}/data")
        return pd.DataFrame()
    return pd.read_csv(p)


def _pair_label() -> str:
    return f"{cfg['currency']}/{cfg.get('target_quote', 'PLN')}"


def _read_pipeline_log(run_path: Path) -> str:
    candidates = [
        run_path / "pipeline.log",
        run_path / cfg.get("output", {}).get("log_name", "app.log"),
        run_path / "app.log",
    ]
    for p in candidates:
        if p.exists():
            return p.read_text(encoding="utf-8", errors="replace")
    return ""


def _read_source_csv_for_latest(run_path: Path) -> pd.DataFrame:
    manifest = run_path / "datasets_manifest.json"
    source_csv: Optional[Path] = None

    if manifest.exists():
        try:
            js = _json_load(manifest)
            src = js.get("source_csv")
            if src:
                source_csv = resolve_path(src)
        except Exception:
            source_csv = None

    if source_csv is None or not source_csv.exists():
        run_data_dir = _run_data_dir(run_path)
        run_patterns = [
            f"raw_{str(cfg['currency']).lower()}{str(cfg.get('target_quote', 'PLN')).lower()}_*.csv",
            f"raw_{str(cfg['currency']).lower()}{str(cfg.get('target_quote', 'PLN')).lower()}.csv",
            f"{str(cfg['currency']).lower()}_a.csv",
            "*.csv",
        ]
        for pat in run_patterns:
            found = sorted(run_data_dir.glob(pat), key=lambda p: p.stat().st_mtime, reverse=True)
            if found:
                source_csv = found[0]
                break

    if source_csv is None or not source_csv.exists():
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
                source_csv = found[0]
                break

    if source_csv is None or not source_csv.exists():
        raise HTTPException(status_code=404, detail="Nie znaleziono źródłowego CSV z danymi.")

    df = pd.read_csv(source_csv)
    df.columns = [str(c).strip() for c in df.columns]

    if "date" not in df.columns and "effectiveDate" in df.columns:
        df = df.rename(columns={"effectiveDate": "date"})
    if "value" not in df.columns and "mid" in df.columns:
        df = df.rename(columns={"mid": "value"})
    if "value" not in df.columns:
        numeric_cols = [c for c in df.columns if c != "date"]
        if len(numeric_cols) == 1:
            df = df.rename(columns={numeric_cols[0]: "value"})

    if "date" not in df.columns or "value" not in df.columns:
        raise HTTPException(status_code=500, detail="Źródłowy CSV nie ma kolumn date/value.")

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["date", "value"]).sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    return df


def _get_latest_value_info(run_path: Path) -> dict[str, Any] | None:
    df = _read_source_csv_for_latest(run_path)
    if df.empty:
        return None

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last

    value = float(last["value"])
    prevv = float(prev["value"])
    delta = value - prevv

    return {
        "date": pd.to_datetime(last["date"]).isoformat(),
        "value": value,
        "prevValue": prevv,
        "delta": delta,
        "deltaPct": (delta / prevv * 100.0) if prevv else 0.0,
    }


def _compat_results_payload(run_path: Path) -> dict[str, Any]:
    metrics = _run_json(run_path, "metrics.json", required=False) or {}
    summary = _run_json(run_path, "summary.json", required=False) or {}
    run_config = _run_json(run_path, "run_config.json", required=False) or {}
    forecast_points = _run_csv(run_path, "forecast_points.csv", required=False)

    forecast_by_h: dict[str, list[dict[str, Any]]] = {}
    if not forecast_points.empty:
        for _, row in forecast_points.iterrows():
            h = str(int(row["H"]))
            forecast_by_h[h] = _df_records(pd.DataFrame([row.to_dict()]))

    latest = _get_latest_value_info(run_path)

    # stary frontend chciał metrics + czasem forecast7 itd.
    out = {
        "lastRate": latest,
        "runConfig": run_config,
        "metrics": metrics,
        "summary": summary,
        "forecast7": forecast_by_h.get("7", []),
        "forecast30": forecast_by_h.get("30", []),
        "forecast90": forecast_by_h.get("90", []),
        "forecast180": forecast_by_h.get("180", []),
        "forecast365": forecast_by_h.get("365", []),
        "updatedAt": pd.Timestamp.utcnow().isoformat(),
        "runDir": str(run_path),
    }
    return out


def _safe_predictions_file(run_path: Path, h: int) -> Path:
    filename = f"predictions_H{h}.csv"
    p = _run_file(run_path, filename)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Brak {filename} w {run_path.name}/data")
    return p


def _safe_horizon_metrics(run_path: Path, h: int) -> dict[str, Any]:
    metrics = _run_json(run_path, "metrics.json")
    by_h = metrics.get("by_horizon", {})
    if str(h) not in by_h:
        raise HTTPException(status_code=404, detail=f"Brak metryk dla H={h}")
    return by_h[str(h)]


def _tail_text(text: str, max_chars: int = 40000) -> str:
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


# =========================================================
# Health
# =========================================================
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "time": pd.Timestamp.utcnow().isoformat(),
        "pair": _pair_label(),
    }


# =========================================================
# Runs API
# =========================================================
@app.get("/api/runs")
def list_runs(limit: int = Query(20, ge=1, le=200)):
    runs = _find_run_dirs()[:limit]
    out = []
    for r in runs:
        status_path = r / "pipeline_status.json"
        summary_path = r / "summary.json"

        item = {
            "name": r.name,
            "path": str(r),
            "modified": pd.Timestamp(r.stat().st_mtime, unit="s").isoformat(),
        }

        if status_path.exists():
            try:
                item["pipeline_status"] = _json_load(status_path)
            except Exception:
                pass

        if summary_path.exists():
            try:
                item["summary"] = _json_load(summary_path)
            except Exception:
                pass

        out.append(item)

    return {"runs": out}


@app.get("/api/runs/latest")
def latest_run():
    run_path = _latest_run()
    return {
        "name": run_path.name,
        "path": str(run_path),
    }


@app.get("/api/runs/{run_name}/summary")
def run_summary(run_name: str):
    run_path = _resolve_run(run_name)
    return _run_json(run_path, "summary.json")


@app.get("/api/runs/{run_name}/metrics")
def run_metrics(run_name: str):
    run_path = _resolve_run(run_name)
    return _run_json(run_path, "metrics.json")


@app.get("/api/runs/{run_name}/backtest")
def run_backtest(run_name: str):
    run_path = _resolve_run(run_name)
    return _run_json(run_path, "backtest.json")


@app.get("/api/runs/{run_name}/forecast")
def run_forecast(run_name: str, h: int = Query(..., ge=1)):
    run_path = _resolve_run(run_name)
    df = _run_csv(run_path, "forecast_points.csv")
    df["H"] = pd.to_numeric(df["H"], errors="coerce")
    df = df[df["H"] == h].copy()
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Brak forecast dla H={h}")
    return {"rows": _df_records(df)}


@app.get("/api/runs/{run_name}/predictions")
def run_predictions(run_name: str, h: int = Query(..., ge=1)):
    run_path = _resolve_run(run_name)
    df = pd.read_csv(_safe_predictions_file(run_path, h))
    return {"rows": _df_records(df)}


@app.get("/api/runs/{run_name}/logs")
def run_logs(run_name: str, offset: int = Query(0, ge=0)):
    run_path = _resolve_run(run_name)
    text = _read_pipeline_log(run_path)
    if offset > len(text):
        offset = 0
    chunk = text[offset:]
    return {
        "text": chunk,
        "nextOffset": offset + len(chunk),
        "run": run_path.name,
    }


# =========================================================
# Run pipeline
# =========================================================
@app.post("/api/run")
def api_run(req: RunReq):
    config_path = resolve_path(req.config)
    if not config_path.exists():
        raise HTTPException(status_code=404, detail=f"Nie znaleziono configu: {config_path}")

    cmd = [sys.executable, "-m", "src.run_experiment", "--config", str(config_path)]

    if req.skip_fetch:
        cmd.append("--skip-fetch")
    if req.skip_build:
        cmd.append("--skip-build")
    if req.skip_train:
        cmd.append("--skip-train")
    if req.no_tuning:
        cmd.append("--no-tuning")
    if req.val_size_samples is not None:
        cmd += ["--val-size-samples", str(req.val_size_samples)]
    if req.test_size_samples is not None:
        cmd += ["--test-size-samples", str(req.test_size_samples)]
    if req.backtest_windows is not None:
        cmd += ["--backtest-windows", str(req.backtest_windows)]

    proc = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        text=True,
        capture_output=True,
    )

    # nawet przy błędzie spróbujmy znaleźć najnowszy run
    latest_run_path = None
    try:
        latest_run_path = _latest_run()
    except Exception:
        latest_run_path = None

    if proc.returncode != 0:
        detail = {
            "message": "Pipeline failed",
            "returncode": proc.returncode,
            "stdout": _tail_text(proc.stdout or ""),
            "stderr": _tail_text(proc.stderr or ""),
            "latestRun": str(latest_run_path) if latest_run_path else None,
        }
        raise HTTPException(status_code=500, detail=detail)

    payload = {
        "ok": True,
        "stdout": _tail_text(proc.stdout or ""),
        "stderr": _tail_text(proc.stderr or ""),
        "runDir": str(latest_run_path) if latest_run_path else None,
    }

    if latest_run_path:
        payload["results"] = _compat_results_payload(latest_run_path)

    return payload


# =========================================================
# Compatibility endpoints for current frontend
# =========================================================
@app.get("/api/results")
def api_results():
    run_path = _latest_run()
    return _compat_results_payload(run_path)


@app.get("/api/series")
def api_series(days: int = Query(365, ge=1, le=20000)):
    run_path = _latest_run()
    df = _read_source_csv_for_latest(run_path)
    df = df.tail(days)
    return {
        "series": [
            {
                "date": pd.to_datetime(row["date"]).isoformat(),
                "value": float(row["value"]),
            }
            for _, row in df.iterrows()
        ]
    }


@app.get("/api/data")
def api_data(limit: int = Query(500, ge=1, le=50000)):
    run_path = _latest_run()
    df = _read_source_csv_for_latest(run_path).tail(limit)
    return {
        "rows": [
            {
                "date": pd.to_datetime(row["date"]).isoformat(),
                "value": float(row["value"]),
            }
            for _, row in df.iterrows()
        ]
    }


@app.get("/api/logs")
def api_logs(offset: int = Query(0, ge=0)):
    run_path = _latest_any_run()
    text = _read_pipeline_log(run_path)
    if offset > len(text):
        offset = 0
    chunk = text[offset:]
    return {
        "text": chunk,
        "logs": chunk,  # kompatybilność
        "nextOffset": offset + len(chunk),
        "state": {
            "run": run_path.name,
            "finished": True,
        },
    }


@app.get("/api/predictions")
def api_predictions(h: int = Query(30, ge=1)):
    run_path = _latest_run()
    df = pd.read_csv(_safe_predictions_file(run_path, h))
    return {"rows": _df_records(df)}


@app.get("/api/forecast")
def api_forecast(h: int = Query(30, ge=1)):
    run_path = _latest_run()
    df = _run_csv(run_path, "forecast_points.csv")
    df["H"] = pd.to_numeric(df["H"], errors="coerce")
    df = df[df["H"] == h].copy()
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Brak forecast dla H={h}")
    return {"rows": _df_records(df)}


# =========================================================
# Artifacts + export
# =========================================================
@app.get("/api/artifacts/{filename}")
def api_artifacts(filename: str, run: Optional[str] = None):
    run_path = _resolve_run(run)
    p = (run_path / filename).resolve()
    if not p.exists():
        p = (_run_data_dir(run_path) / filename).resolve()

    if not str(p).startswith(str(run_path.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")

    if not p.exists():
        raise HTTPException(status_code=404, detail="Not found")

    media_type, _ = mimetypes.guess_type(str(p))
    return FileResponse(
        p,
        media_type=media_type or "application/octet-stream",
        filename=p.name,
    )


@app.get("/api/export/data.xlsx")
def api_export_data_xlsx(limit: int = Query(500, ge=1, le=50000)):
    run_path = _latest_run()
    df = _read_source_csv_for_latest(run_path).tail(limit)

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "EURPLN"
    ws.append(["date", "value"])

    for _, row in df.iterrows():
        ws.append([
            pd.to_datetime(row["date"]).isoformat(),
            float(row["value"]),
        ])

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    headers = {"Content-Disposition": "attachment; filename=eurpln_data.xlsx"}
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )