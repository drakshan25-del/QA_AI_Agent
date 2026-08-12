"""Regression analysis: classify a test run against a baseline run.

The regression feature of the UI/API/Regression triad: given the per-test
results of a baseline (last known-good) run and the current run, classify
every test's transition so a re-run of the same suite answers the question
"did this release break anything that used to work?" (FR-RES-001 extension).

Pure functions over plain result dicts — the V2 engine service stays
stateless; callers (the NestJS backend or CI import) own persistence and
supply both result sets. Result dicts need ``node_id`` and ``outcome``
(``passed`` / ``failed`` / ``error`` / ``skipped``), the shape produced by
:func:`app.services.results.parse_junit`.
"""

from __future__ import annotations

#: Outcomes treated as failing for transition purposes ('error' is an infra
#: or collection failure — for regression verdicts it still means "does not
#: pass anymore").
_FAILING = {"failed", "error"}


def _status(outcome: str) -> str:
    """Collapse a pytest outcome into pass / fail / skip."""
    if outcome == "passed":
        return "pass"
    if outcome in _FAILING:
        return "fail"
    return "skip"


def compare_runs(baseline: list[dict], current: list[dict]) -> dict:
    """Classify ``current`` results against ``baseline`` results per test.

    Args:
        baseline: Per-test result dicts of the last known-good run.
        current: Per-test result dicts of the run under assessment.

    Returns:
        dict with per-transition ``node_id`` lists —

        * ``regressions`` — passed in baseline, fails now (the alarm);
        * ``fixes`` — failed in baseline, passes now;
        * ``still_failing`` — failed in both runs (pre-existing, not new);
        * ``new_tests`` — only in the current run (with their outcome);
        * ``missing_tests`` — in the baseline but absent now (lost coverage);
        * ``skipped`` — skipped in either run (no verdict possible);
        * ``stable_passes`` — count of pass→pass tests;

        plus a ``summary`` block with counts and ``has_regressions`` — the
        single boolean a CI quality gate keys on.

    Duplicate node ids keep the last occurrence (rerun reports list the
    final attempt last, so this favours the retried outcome).
    """
    base_by_id = {str(t.get("node_id", "")): _status(str(t.get("outcome", ""))) for t in baseline}
    curr_by_id = {str(t.get("node_id", "")): _status(str(t.get("outcome", ""))) for t in current}
    base_by_id.pop("", None)
    curr_by_id.pop("", None)

    regressions: list[str] = []
    fixes: list[str] = []
    still_failing: list[str] = []
    skipped: list[str] = []
    stable_passes = 0

    for node_id, curr_status in curr_by_id.items():
        base_status = base_by_id.get(node_id)
        if base_status is None:
            continue  # new test, handled below
        if "skip" in (base_status, curr_status):
            skipped.append(node_id)
        elif base_status == "pass" and curr_status == "fail":
            regressions.append(node_id)
        elif base_status == "fail" and curr_status == "pass":
            fixes.append(node_id)
        elif base_status == "fail" and curr_status == "fail":
            still_failing.append(node_id)
        else:
            stable_passes += 1

    new_tests = [
        {"node_id": node_id, "status": status}
        for node_id, status in curr_by_id.items()
        if node_id not in base_by_id
    ]
    missing_tests = sorted(node_id for node_id in base_by_id if node_id not in curr_by_id)

    return {
        "regressions": sorted(regressions),
        "fixes": sorted(fixes),
        "still_failing": sorted(still_failing),
        "new_tests": sorted(new_tests, key=lambda t: t["node_id"]),
        "missing_tests": missing_tests,
        "skipped": sorted(skipped),
        "stable_passes": stable_passes,
        "summary": {
            "baseline_total": len(base_by_id),
            "current_total": len(curr_by_id),
            "regressed": len(regressions),
            "fixed": len(fixes),
            "still_failing": len(still_failing),
            "new": len(new_tests),
            "missing": len(missing_tests),
            "has_regressions": bool(regressions),
        },
    }
