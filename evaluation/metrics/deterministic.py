"""Deterministic (objective, offline) accuracy metrics.

Wherever the system already provides a ground truth, we use it rather than an
LLM's opinion — this is the strongest part of the accuracy story for the
dissertation because the scores are reproducible and free of judge bias:

* automation validity → the app's **real** validation gate
  (``app.services.validation.validate_generated_code``);
* requirement coverage → ``agents.test_case_agent.coverage_report``;
* near-duplicate cases → ``agents.test_case_agent.find_duplicate_cases``.

Each ``score_*`` returns ``{"scores": {k: 0..1}, "detail": {...}}`` — the scores
feed the rubric blend; the detail is persisted for audit.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from agents.test_case_agent import coverage_report, find_duplicate_cases
from app.models.schemas import TestCaseOutput
from app.services.validation import validate_generated_code
from evaluation.benchmark.schema import BenchmarkItem

#: The ten §8.4 test-plan sections that must all be populated (FR-TP-001).
_PLAN_SECTIONS = (
    "objectives", "scope", "exclusions", "test_types", "environments",
    "test_data", "entry_criteria", "exit_criteria", "risks", "deliverables",
)

#: Case fields whose substantive population signals a complete case (FR-TC-002).
_CASE_FIELDS = ("objective", "preconditions", "test_data", "steps", "expected_results")

_PLACEHOLDERS = {"", "n/a", "na", "none", "none specified", "_none specified._", "todo", "-"}


def _is_placeholder(text: Any) -> bool:
    return str(text).strip().lower() in _PLACEHOLDERS


def _list_substantive(values: list) -> bool:
    return any(not _is_placeholder(v) for v in (values or []))


# ---------------------------------------------------------------------------
# Task 1 — Test Plan
# ---------------------------------------------------------------------------
def score_test_plan(output: Mapping[str, Any], item: BenchmarkItem) -> dict:
    """Section completeness + expected-test-type coverage."""
    complete = [s for s in _PLAN_SECTIONS if _list_substantive(output.get(s))]
    completeness = len(complete) / len(_PLAN_SECTIONS)

    plan_types_text = [str(t).lower() for t in (output.get("test_types") or [])]
    matched_types = [
        t for t in item.expected_test_types
        if any(t.lower() in entry for entry in plan_types_text)
    ]
    type_coverage = (
        len(matched_types) / len(item.expected_test_types)
        if item.expected_test_types else 1.0
    )

    return {
        "scores": {
            "section_completeness": round(completeness, 4),
            "type_coverage": round(type_coverage, 4),
        },
        "detail": {
            "sections_complete": complete,
            "sections_missing": [s for s in _PLAN_SECTIONS if s not in complete],
            "expected_types": item.expected_test_types,
            "matched_types": matched_types,
        },
    }


# ---------------------------------------------------------------------------
# Task 2 — Test Cases
# ---------------------------------------------------------------------------
def score_test_cases(output: Mapping[str, Any], item: BenchmarkItem) -> dict:
    """Coverage, category diversity, field completeness, non-duplication."""
    raw_cases = output.get("test_cases") or []
    cases = [TestCaseOutput.model_validate(c) for c in raw_cases]
    n = len(cases)

    # Requirement traceability (reuses the system's own coverage helper).
    cov = coverage_report([item.requirement.id], cases)
    requirement_coverage = cov["coverage_pct"] / 100.0

    # Category diversity vs the expected spread (FR-TC-003).
    present_categories = {c.category.strip().lower() for c in cases if c.category}
    expected = {c.lower() for c in item.expected_categories}
    matched_categories = sorted(present_categories & expected)
    category_diversity = (len(matched_categories) / len(expected)) if expected else 1.0

    # Field completeness (FR-TC-002): mean fraction of substantive §8.5 fields.
    per_case = []
    for c in cases:
        filled = 0
        filled += 0 if _is_placeholder(c.objective) else 1
        filled += 1 if _list_substantive(c.preconditions) else 0
        filled += 1 if _test_data_substantive(c.test_data) else 0
        filled += 1 if _list_substantive(c.steps) else 0
        filled += 1 if _list_substantive(c.expected_results) else 0
        per_case.append(filled / len(_CASE_FIELDS))
    field_completeness = sum(per_case) / n if n else 0.0

    # Near-duplicate penalty (FR-TC-004): fraction of cases NOT in any dup pair.
    dup_pairs = find_duplicate_cases(cases)
    involved = {i for pair in dup_pairs for i in pair[:2]}
    non_duplication = 1.0 - (len(involved) / n) if n else 1.0

    # Judge-independent checklist keyword coverage (cross-check, not blended).
    checklist_kw = _checklist_keyword_coverage(raw_cases, item)

    return {
        "scores": {
            "requirement_coverage": round(requirement_coverage, 4),
            "category_diversity": round(category_diversity, 4),
            "field_completeness": round(field_completeness, 4),
            "non_duplication": round(non_duplication, 4),
        },
        "detail": {
            "num_cases": n,
            "min_cases": item.min_cases,
            "meets_min_cases": n >= item.min_cases,
            "coverage": cov,
            "matched_categories": matched_categories,
            "missing_categories": sorted(expected - present_categories),
            "duplicate_pairs": dup_pairs,
            "checklist_keyword_coverage": checklist_kw,
        },
    }


def _test_data_substantive(test_data: Mapping[str, Any] | None) -> bool:
    if not test_data:
        return False
    return any(not _is_placeholder(v) for v in test_data.values())


def _checklist_keyword_coverage(raw_cases: list, item: BenchmarkItem) -> dict:
    """Fraction of checklist items whose keywords appear in the generated text.

    A cheap, judge-independent coverage signal. Only items that declare keywords
    are counted (others rely on the judge).
    """
    text = json.dumps(raw_cases, default=str).lower()
    scored = [c for c in item.coverage_checklist if c.keywords]
    if not scored:
        return {"value": None, "matched": [], "total": 0}
    matched = [c.id for c in scored if any(k.lower() in text for k in c.keywords)]
    return {"value": round(len(matched) / len(scored), 4), "matched": matched, "total": len(scored)}


# ---------------------------------------------------------------------------
# Task 3 — Automation (strongest objective signal: the real gate)
# ---------------------------------------------------------------------------
def score_automation(
    output: Mapping[str, Any],
    item: BenchmarkItem,
    run_collection: bool = True,
) -> dict:
    """Run the system's validation gate over the generated files.

    ``gate_pass`` is 1.0 iff the gate reports no error-severity issue (the same
    bar the app enforces before any code is committed/executed).
    ``collection_success`` reflects whether pytest could collect the files.
    """
    files = output.get("files") or []
    if not files:
        return {
            "scores": {"gate_pass": 0.0, "collection_success": 0.0 if run_collection else None},
            "detail": {"error": "no files generated"},
        }

    report = validate_generated_code(files, item.allowed_domains, run_collection=run_collection)
    gate_pass = 1.0 if report.passed else 0.0

    by_check: dict[str, dict[str, int]] = {}
    for issue in report.issues:
        bucket = by_check.setdefault(issue.check, {"error": 0, "warning": 0})
        bucket[issue.severity] = bucket.get(issue.severity, 0) + 1

    collection_errors = [i for i in report.issues if i.check == "collection" and i.severity == "error"]
    collection_success = None
    if run_collection:
        collection_success = 0.0 if collection_errors else 1.0

    return {
        "scores": {
            "gate_pass": gate_pass,
            "collection_success": collection_success,
        },
        "detail": {
            "num_files": len(files),
            "passed": report.passed,
            "num_errors": len(report.errors),
            "num_warnings": len([i for i in report.issues if i.severity == "warning"]),
            "issues_by_check": by_check,
            "issues": [
                {"check": i.check, "severity": i.severity, "message": i.message, "location": i.location}
                for i in report.issues
            ],
        },
    }


#: Dispatch table so the harness can score any task uniformly.
def score_task(task: str, output: Mapping[str, Any], item: BenchmarkItem, run_collection: bool = True) -> dict:
    """Score ``output`` for ``task`` using the appropriate deterministic scorer."""
    if task == "test_plan":
        return score_test_plan(output, item)
    if task == "test_cases":
        return score_test_cases(output, item)
    if task == "automation":
        return score_automation(output, item, run_collection=run_collection)
    raise KeyError(f"no deterministic scorer for task '{task}'")
