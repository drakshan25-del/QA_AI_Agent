"""Explainability — does the artefact justify its choices and trace to the requirement?

Research purpose: a QA artefact a human can trust must make its reasoning
inspectable — justified test types, stated assumptions, per-case objectives,
and code that is traceable back to test cases and requirements. This metric
combines deterministic presence signals (justifications, ``Assumption:`` markers,
``# TC:`` / ``# REQ:`` comments) with the judge's justification-quality score.

Reported separately (not folded into the headline research score), so it informs
"which model is most transparent?" without double-counting readability.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

_STATIC_VS_JUDGE = (0.6, 0.4)


def score_explainability(
    task: str,
    output: Mapping[str, Any],
    raw_text: str,
    judge_scores: Mapping[str, float] | None = None,
) -> dict:
    """Return ``{score, metrics, detail}`` (0..1)."""
    if task == "test_plan":
        static, detail = _plan(output)
    elif task == "test_cases":
        static, detail = _cases(output)
    elif task == "automation":
        static, detail = _automation(output, raw_text)
    else:
        static, detail = 0.0, {}

    judge_just = (judge_scores or {}).get("judge_justification")
    composite = (
        _STATIC_VS_JUDGE[0] * static + _STATIC_VS_JUDGE[1] * judge_just
        if judge_just is not None else static
    )
    return {
        "score": round(composite, 4),
        "metrics": {"explainability": round(composite, 4), "explainability_static": round(static, 4)},
        "detail": detail,
    }


def _plan(output: Mapping[str, Any]) -> tuple[float, dict]:
    types = output.get("test_types") or []
    justified = [t for t in types if ":" in str(t) and str(t).split(":", 1)[1].strip()]
    type_frac = (len(justified) / len(types)) if types else 0.0
    risks = output.get("risks") or []
    risk_frac = (
        sum(1 for r in risks if re.search(r"mitig|by | - |:", str(r))) / len(risks)
    ) if risks else 0.0
    assumptions_marked = any(
        "assumption" in str(x).lower()
        for section in output.values() if isinstance(section, list) for x in section
    )
    static = 0.5 * type_frac + 0.3 * risk_frac + 0.2 * (1.0 if assumptions_marked else 0.0)
    return static, {"justified_types": f"{len(justified)}/{len(types)}", "assumptions_marked": assumptions_marked}


def _cases(output: Mapping[str, Any]) -> tuple[float, dict]:
    cases = output.get("test_cases") or []
    if not cases:
        return 0.0, {"error": "no cases"}
    with_obj = sum(1 for c in cases if str(c.get("objective", "")).strip() not in ("", "N/A"))
    with_trace = sum(1 for c in cases if c.get("requirement_ids"))
    static = 0.5 * (with_obj / len(cases)) + 0.5 * (with_trace / len(cases))
    return static, {"objective_rate": round(with_obj / len(cases), 3), "traceability_rate": round(with_trace / len(cases), 3)}


def _automation(output: Mapping[str, Any], raw_text: str) -> tuple[float, dict]:
    files = output.get("files") or []
    code = "\n".join(str(f.get("content", "")) for f in files)
    tc = code.count("# TC:")
    req = code.count("# REQ:")
    n_tests = len(re.findall(r"def\s+test_\w+", code))
    trace = min(1.0, (min(tc, req) / n_tests)) if n_tests else 0.0
    has_comments = 1.0 if re.search(r'"""|#', code) else 0.0
    static = 0.7 * trace + 0.3 * has_comments
    return static, {"traceable_tests": f"{min(tc, req)}/{n_tests}"}
