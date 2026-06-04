# src/run_experiment.py
from __future__ import annotations
import warnings
from pandas.errors import PerformanceWarning

warnings.filterwarnings("ignore", category=PerformanceWarning)
import argparse
import json
import logging
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .config import load_config, make_run_dir, resolve_path, save_run_config

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("run_experiment")
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


def save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _cmd_to_str(cmd: list[str]) -> str:
    return " ".join(cmd)


def run_stage_with_fallbacks(
    *,
    stage_name: str,
    module_name: str,
    arg_variants: list[list[str]],
    logger: logging.Logger,
) -> dict[str, Any]:
    """
    Próbuje uruchomić moduł kilkoma wariantami argumentów.
    Przydaje się np. gdy fetch_nbp.py jeszcze nie ma --run albo --config.
    """
    errors: list[dict[str, Any]] = []

    for idx, args in enumerate(arg_variants, start=1):
        cmd = [sys.executable, "-m", module_name, *args]
        logger.info(f"[{stage_name}] Attempt {idx}: {_cmd_to_str(cmd)}")

        t0 = time.perf_counter()
        proc = subprocess.run(
            cmd,
            cwd=str(PROJECT_ROOT),
            text=True,
            capture_output=True,
        )
        dt = time.perf_counter() - t0

        if proc.stdout.strip():
            logger.info(f"[{stage_name}] STDOUT:\n{proc.stdout.rstrip()}")

        if proc.stderr.strip():
            logger.info(f"[{stage_name}] STDERR:\n{proc.stderr.rstrip()}")

        if proc.returncode == 0:
            logger.info(f"[{stage_name}] OK in {dt:.2f}s")
            return {
                "stage": stage_name,
                "module": module_name,
                "status": "ok",
                "seconds": round(dt, 3),
                "command": cmd,
                "args_used": args,
            }

        errors.append(
            {
                "attempt": idx,
                "command": cmd,
                "returncode": proc.returncode,
                "stdout": proc.stdout[-4000:] if proc.stdout else "",
                "stderr": proc.stderr[-4000:] if proc.stderr else "",
                "seconds": round(dt, 3),
            }
        )

    logger.error(f"[{stage_name}] FAILED after {len(arg_variants)} attempt(s)")
    raise RuntimeError(
        json.dumps(
            {
                "stage": stage_name,
                "module": module_name,
                "status": "failed",
                "attempts": errors,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def build_stage_variants(
    *,
    config_path: Path,
    run_path: Path,
    no_tuning: bool,
    val_size_samples: int | None,
    test_size_samples: int | None,
    backtest_windows: int | None,
) -> tuple[list[list[str]], list[list[str]], list[list[str]]]:
    config_s = str(config_path)
    run_s = str(run_path)

    # fetch_nbp może być jeszcze starszy, więc dajemy fallbacki
    fetch_variants = [
        ["--config", config_s, "--run", run_s],
        ["--config", config_s],
        [],
    ]

    build_variants = [
        ["--config", config_s, "--run", run_s],
        ["--config", config_s],
    ]

    train_base = ["--config", config_s, "--run", run_s]
    if no_tuning:
        train_base.append("--no-tuning")
    if val_size_samples is not None:
        train_base += ["--val-size-samples", str(val_size_samples)]
    if test_size_samples is not None:
        train_base += ["--test-size-samples", str(test_size_samples)]
    if backtest_windows is not None:
        train_base += ["--backtest-windows", str(backtest_windows)]

    train_variants = [
        train_base,
        [x for x in train_base if x not in {"--run", run_s}],  # fallback bez --run
    ]

    return fetch_variants, build_variants, train_variants


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/config.json")
    ap.add_argument("--run", default=None, help="runs/<timestamp>; jeśli brak -> tworzy nowy")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--skip-build", action="store_true")
    ap.add_argument("--skip-train", action="store_true")
    ap.add_argument("--no-tuning", action="store_true")
    ap.add_argument("--val-size-samples", type=int, default=None)
    ap.add_argument("--test-size-samples", type=int, default=None)
    ap.add_argument("--backtest-windows", type=int, default=None)
    args = ap.parse_args()

    cfg = load_config(args.config)

    if args.run is None:
        run_path = make_run_dir(cfg["output"]["runs_dir"])
    else:
        run_path = resolve_path(args.run)
        run_path.mkdir(parents=True, exist_ok=True)
        (run_path / cfg["output"].get("plots_dir_name", "plots")).mkdir(parents=True, exist_ok=True)

    save_run_config(cfg, run_path)

    logger = setup_logger(run_path / "pipeline.log")
    logger.info(f"START run_experiment | run_dir={run_path}")

    config_path = resolve_path(args.config)

    fetch_variants, build_variants, train_variants = build_stage_variants(
        config_path=config_path,
        run_path=run_path,
        no_tuning=args.no_tuning,
        val_size_samples=args.val_size_samples,
        test_size_samples=args.test_size_samples,
        backtest_windows=args.backtest_windows,
    )

    stage_results: list[dict[str, Any]] = []
    started_at = time.strftime("%Y-%m-%d %H:%M:%S")

    try:
        if not args.skip_fetch:
            stage_results.append(
                run_stage_with_fallbacks(
                    stage_name="fetch",
                    module_name="src.fetch_nbp",
                    arg_variants=fetch_variants,
                    logger=logger,
                )
            )
        else:
            logger.info("[fetch] skipped")
            stage_results.append({"stage": "fetch", "status": "skipped"})

        if not args.skip_build:
            stage_results.append(
                run_stage_with_fallbacks(
                    stage_name="build_dataset",
                    module_name="src.build_dataset",
                    arg_variants=build_variants,
                    logger=logger,
                )
            )
        else:
            logger.info("[build_dataset] skipped")
            stage_results.append({"stage": "build_dataset", "status": "skipped"})

        if not args.skip_train:
            stage_results.append(
                run_stage_with_fallbacks(
                    stage_name="train_eval",
                    module_name="src.train_eval",
                    arg_variants=train_variants,
                    logger=logger,
                )
            )
        else:
            logger.info("[train_eval] skipped")
            stage_results.append({"stage": "train_eval", "status": "skipped"})

        status = {
            "status": "ok",
            "started_at": started_at,
            "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "run_dir": str(run_path),
            "stages": stage_results,
        }
        save_json(run_path / "pipeline_status.json", status)
        logger.info("DONE run_experiment")
    except Exception as e:
        status = {
            "status": "failed",
            "started_at": started_at,
            "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "run_dir": str(run_path),
            "stages": stage_results,
            "error": str(e),
        }
        save_json(run_path / "pipeline_status.json", status)
        logger.exception("FAILED run_experiment")
        raise


if __name__ == "__main__":
    main()