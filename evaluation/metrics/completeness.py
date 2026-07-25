"""Output Completeness — does the artefact contain every element it should?

Research purpose: a QA artefact that omits required sections is unusable
regardless of how good the present parts are. Completeness is a deterministic,
per-task checklist of *required elements* expressed as a percentage (e.g.
"17/18 = 94%"), independent of the LLM judge. It reuses the same section/field
notions the accuracy metric uses, so completeness and accuracy stay consistent.

Anchors: mirrors document-completeness / structural-coverage checks common in
software-artefact evaluation; for code it inspects for the concrete elements a
runnable Playwright POM test needs.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.metrics.deterministic import (
    _PLAN_SECTIONS,
    _is_placeholder,
    _list_substantive,
    _test_data_substantive,
)

#: Required §8.5 fields for a complete test case (FR-TC-002).
_CASE_REQUIRED = ("steps", "expected_results", "preconditions", "priority", "requirement_ids")

#: Required elements of a runnable Playwright POM test file (FR-AUT-001..006).
_CODE_ELEMENTS = ("imports", "page_object_usage", "assertions", "fixtures_config", "traceability_comments")


def score_completeness(task: str, output: Mapping[str, Any], item: BenchmarkItem) -> dict:
    """Return ``{score, metrics, detail}`` — completeness as a 0..1 fraction."""
    if task == "test_plan":
        return _plan(output)
    if task == "test_cases":
        return _cases(output)
    if task == "automation":
        return _automation(output)
    raise KeyError(f"no completeness scorer for task '{task}'")


def _result(present: list[str], required: list[str], extra_detail: dict | None = None) -> dict:
    total = len(required)
    got = len(present)
    score = (got / total) if total else 1.0
    detail = {
        "present": present,
        "missing": [r for r in required if r not in present],
        "ratio": f"{got}/{total}",
    }
    if extra_detail:
        detail.update(extra_detail)
    return {
        "score": round(score, 4),
        "metrics": {"completeness_pct": round(score * 100, 2)},
        "detail": detail,
    }


def _plan(output: Mapping[str, Any]) -> dict:
    present = [s for s in _PLAN_SECTIONS if _list_substantive(output.get(s))]
    return _result(present, list(_PLAN_SECTIONS))


def _cases(output: Mapping[str, Any]) -> dict:
    cases = output.get("test_cases") or []
    if not cases:
        return {"score": 0.0, "metrics": {"completeness_pct": 0.0}, "detail": {"error": "no cases"}}
    # Completeness = mean over cases of the fraction of required fields populated.
    per_field_hits = {f: 0 for f in _CASE_REQUIRED}
    per_case_fracs: list[float] = []
    for c in cases:
        got = 0
        for f in _CASE_REQUIRED:
            val = c.get(f)
            ok = (
                _test_data_substantive(val) if f == "test_data"
                else (not _is_placeholder(val)) if isinstance(val, str)
                else _list_substantive(val) if isinstance(val, list)
                else bool(val)
            )
            if ok:
                got += 1
                per_field_hits[f] += 1
        per_case_fracs.append(got / len(_CASE_REQUIRED))
    score = sum(per_case_fracs) / len(cases)
    return {
        "score": round(score, 4),
        "metrics": {"completeness_pct": round(score * 100, 2)},
        "detail": {
            "num_cases": len(cases),
            "field_hit_rate": {f: round(h / len(cases), 3) for f, h in per_field_hits.items()},
        },
    }


def _automation(output: Mapping[str, Any]) -> dict:
    files = output.get("files") or []
    if not files:
        return {"score": 0.0, "metrics": {"completeness_pct": 0.0}, "detail": {"error": "no files"}}
    code = "\n".join(str(f.get("content", "")) for f in files)
    present: list[str] = []
    if re.search(r"^\s*(import|from)\s+\w", code, re.MULTILINE):
        present.append("imports")
    if "automation.pages" in code:
        present.append("page_object_usage")
    if re.search(r"\bexpect\s*\(", code) or re.search(r"\bassert(_|\s)", code):
        present.append("assertions")
    if re.search(r"\b(base_url|credentials|target_available)\b", code):
        present.append("fixtures_config")
    if "# TC:" in code and "# REQ:" in code:
        present.append("traceability_comments")
    extra = {
        "has_error_handling": bool(re.search(r"\b(try:|pytest\.raises)\b", code)),
        "num_files": len(files),
    }
    return _result(present, list(_CODE_ELEMENTS), extra)
