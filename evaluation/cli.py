"""Command-line entry point for the evaluation framework.

    python -m evaluation.cli run       [--models …] [--tasks …] [--reps N] [--items …]
    python -m evaluation.cli export    [--batch ID] [--out-dir DIR]
    python -m evaluation.cli dashboard [--db PATH]
    python -m evaluation.cli models    # list registered models

Everything an experiment needs is expressible as flags so runs are scriptable
and reproducible.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from evaluation.config import (
    DEFAULT_BENCHMARK_DIR,
    DEFAULT_DB_PATH,
    DEFAULT_EXPORT_DIR,
    TASKS,
    EvalConfig,
)
from evaluation.models import REGISTRY, DEFAULT_JUDGE_MODEL, default_model_names


def _csv(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def _parse_reps_cap(value: str | None) -> dict[str, int]:
    """Parse ``"model:count,model:count"`` into a per-model repetition cap."""
    caps: dict[str, int] = {}
    for part in _csv(value or ""):
        if ":" in part:
            name, count = part.rsplit(":", 1)
            caps[name.strip()] = int(count)
    return caps


def _build_run_config(args: argparse.Namespace) -> EvalConfig:
    tasks = TASKS if args.tasks in (None, "all") else tuple(_csv(args.tasks))
    return EvalConfig(
        models=_csv(args.models) if args.models else default_model_names(),
        tasks=tasks,
        repetitions=args.reps,
        judge_model=args.judge_model,
        use_judge=not args.no_judge,
        run_collection=not args.no_collection,
        run_execution=args.run_execution,
        robustness=args.robustness,
        skip_slow_models=args.skip_slow_models,
        max_reps_per_model=_parse_reps_cap(args.max_reps_per_model),
        db_path=Path(args.db),
        benchmark_dir=Path(args.benchmark_dir),
    )


def cmd_run(args: argparse.Namespace) -> int:
    from evaluation.harness import Harness

    config = _build_run_config(args)
    harness = Harness(config)
    batch_id = harness.run(item_ids=_csv(args.items) if args.items else None)
    print(f"\nDone. Export with:  python -m evaluation.cli export --batch {batch_id}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    from evaluation.store import EvalStore
    from evaluation.store.export import export_batch

    store = EvalStore(args.db)
    paths = export_batch(store, args.batch, args.out_dir)
    print("Exported:")
    for name, path in paths.items():
        print(f"  {name:<22} {path}")
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    app = Path(__file__).parent / "dashboard" / "app.py"
    print(f"Launching Streamlit dashboard for {args.db} …")
    try:
        return subprocess.call(
            [sys.executable, "-m", "streamlit", "run", str(app), "--", "--db", args.db]
        )
    except FileNotFoundError:
        print("Streamlit is not installed. Install with: pip install -r requirements-eval.txt")
        return 1


def cmd_models(_args: argparse.Namespace) -> int:
    print("Registered models:")
    for spec in REGISTRY.values():
        print(f"  {spec.name:<22} source={spec.source:<10} {spec.notes}")
    print(f"\nDefault judge (held-out): {DEFAULT_JUDGE_MODEL}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="evaluation", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run an evaluation batch")
    run.add_argument("--models", help="comma-separated model names (default: all pretrained)")
    run.add_argument("--tasks", default="all", help=f"comma-separated subset of {TASKS} or 'all'")
    run.add_argument("--reps", type=int, default=3, help="repetitions per (model,task,item)")
    run.add_argument("--items", help="comma-separated benchmark item ids (default: all)")
    run.add_argument("--judge-model", default=DEFAULT_JUDGE_MODEL, help="held-out judge model")
    run.add_argument("--no-judge", action="store_true", help="deterministic-only (offline)")
    run.add_argument("--no-collection", action="store_true", help="skip pytest collection in the gate")
    run.add_argument("--run-execution", action="store_true", help="also execute generated tests (opt-in)")
    run.add_argument("--robustness", action="store_true", help="also run prompt-variant robustness (opt-in, slower)")
    run.add_argument("--skip-slow-models", action="store_true", help="exclude models flagged slow (e.g. deepseek-r1)")
    run.add_argument("--max-reps-per-model", help="per-model rep cap, e.g. 'deepseek-r1:8b:1'")
    run.add_argument("--db", default=str(DEFAULT_DB_PATH))
    run.add_argument("--benchmark-dir", default=str(DEFAULT_BENCHMARK_DIR))
    run.set_defaults(func=cmd_run)

    export = sub.add_parser("export", help="export a batch to CSV/JSON")
    export.add_argument("--batch", help="batch id (default: latest)")
    export.add_argument("--db", default=str(DEFAULT_DB_PATH))
    export.add_argument("--out-dir", default=str(DEFAULT_EXPORT_DIR))
    export.set_defaults(func=cmd_export)

    dash = sub.add_parser("dashboard", help="launch the Streamlit comparison dashboard")
    dash.add_argument("--db", default=str(DEFAULT_DB_PATH))
    dash.set_defaults(func=cmd_dashboard)

    models = sub.add_parser("models", help="list registered models")
    models.set_defaults(func=cmd_models)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
