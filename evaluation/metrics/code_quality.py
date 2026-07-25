"""Code Quality — software-engineering best-practice score for generated tests.

Research purpose: executable code can still be poor code. This metric rates the
maintainability of generated Playwright suites against concrete, deterministic
software-engineering signals (Page Object Model adherence, assertion presence,
cyclomatic complexity, duplication, naming, traceability comments), optionally
blended with the judge's readability/maintainability view. Automation task only.

Anchors: POM is the project's mandated pattern (FR-AUT-003); cyclomatic
complexity (McCabe) and clone/duplication detection are standard static-analysis
maintainability signals.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Mapping
from difflib import SequenceMatcher
from typing import Any

#: Sub-weights blending the deterministic static signals into one static score.
_STATIC_WEIGHTS = {
    "pom_adherence": 0.25,
    "assertion_quality": 0.20,
    "complexity": 0.15,
    "non_duplication": 0.15,
    "naming": 0.10,
    "traceability": 0.15,
}
#: How static analysis and the judge's readability view combine.
_STATIC_VS_JUDGE = (0.7, 0.3)


def score_code_quality(
    output: Mapping[str, Any],
    judge_scores: Mapping[str, float] | None = None,
) -> dict:
    """Return ``{score, metrics, detail}`` (0..1) for the generated code."""
    files = output.get("files") or []
    if not files:
        return {"score": 0.0, "metrics": {"code_quality": 0.0}, "detail": {"error": "no files"}}
    code = "\n".join(str(f.get("content", "")) for f in files)

    funcs = _test_functions(code)
    sub = {
        "pom_adherence": _pom_adherence(code),
        "assertion_quality": _assertion_quality(funcs, code),
        "complexity": _complexity_score(funcs),
        "non_duplication": _non_duplication(funcs),
        "naming": _naming(funcs, files),
        "traceability": 1.0 if ("# TC:" in code and "# REQ:" in code) else 0.0,
    }
    static = sum(_STATIC_WEIGHTS[k] * v for k, v in sub.items())

    judge_read = (judge_scores or {}).get("judge_readability")
    if judge_read is not None:
        composite = _STATIC_VS_JUDGE[0] * static + _STATIC_VS_JUDGE[1] * judge_read
    else:
        composite = static

    return {
        "score": round(composite, 4),
        "metrics": {
            "code_quality": round(composite, 4),
            "code_quality_static": round(static, 4),
            **{f"cq_{k}": round(v, 3) for k, v in sub.items()},
        },
        "detail": {"sub_scores": {k: round(v, 3) for k, v in sub.items()}, "num_test_functions": len(funcs)},
    }


def _test_functions(code: str) -> list[ast.FunctionDef]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    return [
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name.startswith("test")
    ]


def _pom_adherence(code: str) -> float:
    uses_pages = "automation.pages" in code
    raw_selectors = bool(re.search(r"\.(locator|query_selector)\(|xpath=|css=", code))
    score = 0.0
    score += 0.6 if uses_pages else 0.0
    score += 0.4 if not raw_selectors else 0.0
    return score


def _assertion_quality(funcs: list[ast.FunctionDef], code: str) -> float:
    if not funcs:
        return 1.0 if re.search(r"\bexpect\s*\(", code) else 0.0
    with_assert = 0
    for fn in funcs:
        body = ast.dump(fn)
        if "expect" in body or "Assert" in body or "assert_" in ast.unparse(fn):
            with_assert += 1
    return with_assert / len(funcs)


def _complexity_score(funcs: list[ast.FunctionDef]) -> float:
    """1.0 for simple linear tests; decreases as branch complexity grows."""
    if not funcs:
        return 1.0
    scores = []
    for fn in funcs:
        branches = sum(
            isinstance(n, (ast.If, ast.For, ast.While, ast.Try, ast.BoolOp, ast.comprehension))
            for n in ast.walk(fn)
        )
        # McCabe-ish: complexity = branches + 1; tests should be ~1-3.
        complexity = branches + 1
        scores.append(1.0 if complexity <= 3 else max(0.0, 1.0 - (complexity - 3) * 0.2))
    return sum(scores) / len(scores)


def _non_duplication(funcs: list[ast.FunctionDef]) -> float:
    if len(funcs) < 2:
        return 1.0
    bodies = [ast.unparse(fn) for fn in funcs]
    dup_pairs = 0
    total = 0
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            total += 1
            if SequenceMatcher(None, bodies[i], bodies[j]).ratio() >= 0.9:
                dup_pairs += 1
    return 1.0 - (dup_pairs / total) if total else 1.0


def _naming(funcs: list[ast.FunctionDef], files: list) -> float:
    name_ok = [bool(re.fullmatch(r"test_[a-z0-9_]+", fn.name)) for fn in funcs]
    file_ok = [
        bool(re.fullmatch(r"test_[a-z0-9_]+\.py", str(f.get("path", "")).rsplit("/", 1)[-1]))
        for f in files
    ]
    checks = name_ok + file_ok
    return (sum(checks) / len(checks)) if checks else 1.0
