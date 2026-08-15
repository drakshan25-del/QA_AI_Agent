"""CI regression gate: fail the pipeline when previously-passing tests fail.

Compares the regression suite's current JUnit report against the baseline
report from the last successful run of the workflow on ``main`` (downloaded
by the "Fetch regression baseline" step in ``playwright-ci.yml``) and keys
its verdict on :func:`app.services.regression.compare_runs` — the job fails
iff ``summary.has_regressions`` is true, i.e. at least one test that passed
in the baseline fails or errors now.

Exit codes:
    0 — no regressions, or nothing to compare: the current report is missing
        (the regression suite may have collected no tests — pytest exit
        code 5 is tolerated by the suite step) or no baseline is available
        yet (first run, expired artifact, no successful main run).
    1 — at least one pass -> fail transition against the baseline.

Deliberately import-light (stdlib plus the pure ``results``/``regression``
services) so CI can run it straight after ``uv sync`` without the
FastAPI/Ollama stack.

Run (from apps/qa-engine):
    uv run python scripts/regression_gate.py BASELINE_XML CURRENT_XML [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow running as ``python scripts/regression_gate.py`` from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.regression import compare_runs  # noqa: E402
from app.services.results import parse_junit  # noqa: E402


def _print_summary(comparison: dict) -> None:
    """Print the transition counts and every regressed node id."""
    summary = comparison["summary"]
    print(
        f"Regression gate: baseline={summary['baseline_total']} tests, "
        f"current={summary['current_total']} tests"
    )
    print(
        f"  regressed={summary['regressed']} fixed={summary['fixed']} "
        f"still_failing={summary['still_failing']} new={summary['new']} "
        f"missing={summary['missing']} skipped={len(comparison['skipped'])} "
        f"stable_passes={comparison['stable_passes']}"
    )
    if comparison["regressions"]:
        print("Regressed tests (passed in baseline, failing now):")
        for node_id in comparison["regressions"]:
            print(f"  REGRESSION: {node_id}")
    else:
        print("No regressions detected.")


def main(argv: list[str] | None = None) -> int:
    """Run the gate; returns the process exit code (0 = pass, 1 = regressions)."""
    parser = argparse.ArgumentParser(
        description=(
            "Compare a current JUnit report against a baseline and fail "
            "(exit 1) iff a previously-passing test fails now."
        )
    )
    parser.add_argument("baseline", type=Path, help="baseline junit XML (last good main run)")
    parser.add_argument("current", type=Path, help="current junit XML (this run)")
    parser.add_argument(
        "--json",
        action="store_true",
        help="print the full compare_runs dict as JSON instead of the summary",
    )
    args = parser.parse_args(argv)

    # Missing reports never fail the gate — both are legitimate CI states.
    if not args.current.is_file():
        print(
            f"current junit report not found at {args.current}; the regression "
            "suite may have collected no tests. Skipping regression gate."
        )
        return 0
    if not args.baseline.is_file():
        print("no baseline available; skipping regression gate")
        return 0

    baseline_tests = parse_junit(args.baseline)["tests"]
    current_tests = parse_junit(args.current)["tests"]
    comparison = compare_runs(baseline_tests, current_tests)

    if args.json:
        print(json.dumps(comparison, indent=2))
    else:
        _print_summary(comparison)
    return 1 if comparison["summary"]["has_regressions"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
