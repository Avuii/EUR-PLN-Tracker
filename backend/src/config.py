# src/config.py
from __future__ import annotations
import warnings
from pandas.errors import PerformanceWarning

warnings.filterwarnings("ignore", category=PerformanceWarning)
import copy
import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "configs" / "config.json"


DEFAULT_CONFIG: dict[str, Any] = {
    # -------------------- basic --------------------
    "project_name": "EUR/PLN Tracker",
    "currency": "EUR",
    "target_quote": "PLN",
    "nbp_table": "A",
    "seed": 123,

    # -------------------- time range --------------------
    "date_range": {
        "start": "2010-01-01",
        "end": "TODAY",
    },

    # -------------------- horizons --------------------
    # business-day horizons
    "horizons_H": [1, 7, 30, 90, 180, 365],

    # -------------------- dataset windows --------------------
    # fixed | auto
    "window_mode": "auto",

    # fallback / legacy
    "window_W": 60,

    # explicit overrides per horizon (wins over auto)
    "window_by_horizon": {
        "1": 20,
        "7": 30,
        "30": 60,
        "90": 120,
        "180": 180,
        "365": 260,
    },

    # rolling windows candidate set used by build_dataset
    "rolling_windows": [5, 10, 20, 60],

    # ema spans used by build_dataset
    "ema_spans": [10, 20],

    # -------------------- split --------------------
    "split": {
        "val_size": 130,
        "test_size": 260,
    },

    # -------------------- training --------------------
    "training": {
        "no_tuning": False,
        "cv_splits": 5,
        "random_search_iter": {
            "Ridge": 30,
            "ElasticNet": 40,
            "MLPRegressor": 20,
            "RandomForest": 40,
            "ExtraTrees": 40,
            "HistGB": 35,
            "XGBoost": 25,
            "LightGBM": 25,
        },
    },

    # -------------------- backtest --------------------
    "backtest": {
        "enabled": True,
        "windows": 5,
    },

    # -------------------- visualization --------------------
    "viz": {
        "zoom_window_days": 90,
        "zoom_by_horizon": {
            "1": 45,
            "7": 60,
            "30": 120,
            "90": 220,
            "180": 320,
            "365": 520,
        },
    },

    # -------------------- model registry --------------------
    "models": {
        "enabled": [
            "Naive",
            "SMA",
            "EMA",
            "Ridge",
            "ElasticNet",
            "RandomForest",
            "ExtraTrees",
            "HistGB",
            "SARIMAX",
            "MLPRegressor",
            "XGBoost",
            "LightGBM",
        ],

        # dla baseline tuningów
        "baseline_candidates": {
            "SMA": [5, 10, 20, 60],
            "EMA": [5, 10, 20, 60],
        },

        # tree/boosting intervals
        "prediction_intervals": {
            "enabled": True,
            "p80": [0.10, 0.90],
            "p95": [0.025, 0.975],
        },

        # klasyczne szeregi czasowe
        "sarimax": {
            "enabled": True,
            "order": [1, 1, 1],
            "seasonal_order": None,
            "fair_refit_on_last_W": True,
        },

        # optional packages — można sprawdzać availability
        "optional_backends": {
            "xgboost_enabled": False,
            "lightgbm_enabled": False,
        },
    },

    # -------------------- artifacts --------------------
    "artifacts": {
        "save_predictions_csv": True,
        "save_metrics_csv": True,
        "save_best_params_json": True,
        "save_search_spaces_json": True,
        "save_manifest_json": True,
        "save_summary_json": True,
    },

    # -------------------- output --------------------
    "output": {
        "data_dir": "data",
        "runs_dir": "runs",
        "log_name": "app.log",
        "plots_dir_name": "plots",
    },

    # -------------------- api --------------------
    "api": {
        "host": "127.0.0.1",
        "port": 8000,
        "cors_origins": [
            "http://localhost:4000",
            "http://127.0.0.1:4000",
        ],
    },
}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _resolve_today(value: Any) -> Any:
    if isinstance(value, str) and value.upper() == "TODAY":
        return str(date.today())
    return value


def _normalize_special_values(cfg: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(cfg)

    if "date_range" not in out:
        out["date_range"] = {}

    out["date_range"]["start"] = _resolve_today(
        out["date_range"].get("start", DEFAULT_CONFIG["date_range"]["start"])
    )
    out["date_range"]["end"] = _resolve_today(
        out["date_range"].get("end", DEFAULT_CONFIG["date_range"]["end"])
    )

    return out


def resolve_path(p: str | Path) -> Path:
    p = Path(p)
    if p.is_absolute():
        return p

    cand_project = PROJECT_ROOT / p
    if cand_project.exists():
        return cand_project

    cand_cwd = Path.cwd() / p
    if cand_cwd.exists():
        return cand_cwd

    return cand_project


def get_default_config() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_CONFIG)


def validate_config(cfg: dict[str, Any]) -> None:
    required_top = ["currency", "nbp_table", "date_range", "horizons_H", "output"]
    for key in required_top:
        if key not in cfg:
            raise ValueError(f"Brak wymaganego klucza config: {key}")

    if "start" not in cfg["date_range"] or "end" not in cfg["date_range"]:
        raise ValueError("config.date_range musi zawierać start i end")

    hs = cfg.get("horizons_H", [])
    if not isinstance(hs, list) or not hs:
        raise ValueError("config.horizons_H musi być niepustą listą")

    try:
        hs_int = [int(h) for h in hs]
    except Exception as e:
        raise ValueError(f"config.horizons_H zawiera niepoprawne wartości: {hs}") from e

    if any(h <= 0 for h in hs_int):
        raise ValueError("Wszystkie horizons_H muszą być > 0")

    mode = str(cfg.get("window_mode", "fixed")).lower().strip()
    if mode not in {"fixed", "auto"}:
        raise ValueError("config.window_mode musi być 'fixed' albo 'auto'")

    if int(cfg.get("window_W", 1)) <= 0:
        raise ValueError("config.window_W musi być > 0")

    split = cfg.get("split", {})
    if int(split.get("val_size", 0)) < 0 or int(split.get("test_size", 0)) <= 0:
        raise ValueError("config.split musi mieć val_size >= 0 i test_size > 0")

    output = cfg.get("output", {})
    for key in ["data_dir", "runs_dir", "log_name"]:
        if key not in output:
            raise ValueError(f"Brak output.{key} w configu")


def write_default_config(path: str | Path = DEFAULT_CONFIG_PATH, overwrite: bool = False) -> Path:
    path = resolve_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists() and not overwrite:
        return path

    path.write_text(
        json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def ensure_main_config(path: str | Path = DEFAULT_CONFIG_PATH) -> Path:
    path = resolve_path(path)
    if not path.exists():
        write_default_config(path, overwrite=False)
    return path


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    path = ensure_main_config(path)
    user_cfg = json.loads(path.read_text(encoding="utf-8"))

    cfg = _deep_merge(DEFAULT_CONFIG, user_cfg)
    cfg = _normalize_special_values(cfg)
    validate_config(cfg)
    return cfg


def save_run_config(cfg: dict[str, Any], run_dir: Path) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def make_run_dir(runs_dir: str | Path) -> Path:
    runs_dir = resolve_path(runs_dir)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = runs_dir / ts
    plots_dir_name = DEFAULT_CONFIG["output"]["plots_dir_name"]
    (run_dir / plots_dir_name).mkdir(parents=True, exist_ok=True)
    return run_dir


def get_runs_dir(cfg: dict[str, Any]) -> Path:
    return resolve_path(cfg["output"]["runs_dir"])


def get_data_dir(cfg: dict[str, Any]) -> Path:
    return resolve_path(cfg["output"]["data_dir"])


def get_plots_dir(run_dir: str | Path, cfg: dict[str, Any] | None = None) -> Path:
    run_dir = resolve_path(run_dir)
    plots_name = (cfg or DEFAULT_CONFIG)["output"].get("plots_dir_name", "plots")
    p = run_dir / plots_name
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_effective_window_for_horizon(cfg: dict[str, Any], H: int) -> int:
    per_h = cfg.get("window_by_horizon", {}) or {}

    if str(H) in per_h:
        return int(per_h[str(H)])
    if H in per_h:
        return int(per_h[H])

    mode = str(cfg.get("window_mode", "fixed")).lower().strip()
    if mode == "auto":
        if H <= 7:
            return 30
        if H <= 30:
            return 60
        if H <= 90:
            return 120
        if H <= 180:
            return 180
        return 260

    return int(cfg.get("window_W", 60))


def get_zoom_window_for_horizon(cfg: dict[str, Any], H: int) -> int:
    zoom_map = cfg.get("viz", {}).get("zoom_by_horizon", {}) or {}
    if str(H) in zoom_map:
        return int(zoom_map[str(H)])
    if H in zoom_map:
        return int(zoom_map[H])

    return int(cfg.get("viz", {}).get("zoom_window_days", 90))


def model_enabled(cfg: dict[str, Any], model_name: str) -> bool:
    enabled = cfg.get("models", {}).get("enabled", [])
    enabled_norm = {str(x).strip().lower() for x in enabled}
    return str(model_name).strip().lower() in enabled_norm


def enabled_models(cfg: dict[str, Any]) -> list[str]:
    return [str(x) for x in cfg.get("models", {}).get("enabled", [])]