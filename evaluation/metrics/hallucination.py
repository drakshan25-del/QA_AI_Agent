"""Hallucination Rate — unsupported, fabricated or invalid content.

Research purpose: hallucination is the central trust risk for LLM-generated QA
artefacts (invented APIs, non-existent Playwright methods, invalid assertions,
fabricated requirements). This metric combines two evidence sources:

* **Deterministic code checks** (automation only, low false-positive): via AST it
  flags calls to page-object methods that do not exist and Playwright
  ``expect(...)`` matchers / ``page`` methods that are not part of the real API —
  precise, objective "invented method" detection.
* **Judge findings**: the held-out judge lists semantic hallucinations (fabricated
  requirements, unsupported assumptions) already tagged Critical/Major/Minor.

Findings are severity-weighted (critical 1.0, major 0.6, minor 0.3) into a
severity score; the research dimension is *cleanliness* = 1 − min(1, severity/CAP).

Anchors: faithfulness/hallucination taxonomies in NLG evaluation, adapted to
code with an API-existence oracle.
"""

from __future__ import annotations

import ast
import functools
from collections.abc import Mapping, Sequence
from typing import Any

from evaluation.config import REPO_ROOT

_SEVERITY_WEIGHT = {"critical": 1.0, "major": 0.6, "minor": 0.3}
#: Severity total at which cleanliness hits 0 (≈3 criticals or 5 majors).
_SEVERITY_CAP = 3.0

# Curated real-API allow-lists (Playwright Python sync API). Conservative but
# broad, so legitimate code is not falsely flagged as hallucinated.
_KNOWN_PAGE = {
    "goto", "go_back", "go_forward", "reload", "click", "dblclick", "fill", "type", "press",
    "check", "uncheck", "hover", "focus", "select_option", "set_input_files", "locator",
    "frame_locator", "get_by_role", "get_by_label", "get_by_placeholder", "get_by_test_id",
    "get_by_text", "get_by_alt_text", "get_by_title", "wait_for_load_state", "wait_for_url",
    "wait_for_selector", "wait_for_timeout", "screenshot", "title", "url", "content",
    "inner_text", "text_content", "is_visible", "is_enabled", "is_checked", "query_selector",
    "evaluate", "set_default_timeout", "bring_to_front", "close", "on", "expect",
}
_KNOWN_LOCATOR = {
    "click", "dblclick", "fill", "type", "press", "check", "uncheck", "hover", "focus",
    "select_option", "set_input_files", "get_by_role", "get_by_label", "get_by_placeholder",
    "get_by_test_id", "get_by_text", "get_by_alt_text", "get_by_title", "nth", "first", "last",
    "filter", "count", "all", "is_visible", "is_enabled", "is_checked", "inner_text",
    "text_content", "input_value", "get_attribute", "wait_for", "scroll_into_view_if_needed",
    "highlight", "blur", "clear", "press_sequentially", "locator",
}
_KNOWN_MATCHERS = {
    "to_be_visible", "to_be_hidden", "to_be_enabled", "to_be_disabled", "to_be_checked",
    "to_be_editable", "to_be_empty", "to_be_focused", "to_be_attached", "to_contain_text",
    "to_have_text", "to_have_value", "to_have_values", "to_have_count", "to_have_attribute",
    "to_have_class", "to_have_id", "to_have_title", "to_have_url", "to_have_css", "to_have_role",
}


@functools.lru_cache(maxsize=1)
def _page_object_methods() -> frozenset[str]:
    """Union of all public+private method names across automation/pages/*.py."""
    methods: set[str] = set()
    pages = REPO_ROOT / "automation" / "pages"
    for py in pages.glob("*.py"):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        methods.add(child.name)
    return frozenset(methods)


@functools.lru_cache(maxsize=1)
def _page_object_classes() -> frozenset[str]:
    names: set[str] = set()
    pages = REPO_ROOT / "automation" / "pages"
    for py in pages.glob("*.py"):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue
        names |= {n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
    return frozenset(names)


def _detect_code_hallucinations(code: str) -> list[dict]:
    """Flag invented page-object methods and non-existent Playwright API (best-effort)."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []  # syntax errors are the gate's job, not a hallucination
    po_methods = _page_object_methods()
    po_classes = _page_object_classes()
    valid_po = po_methods | _KNOWN_LOCATOR

    # vars assigned from a page-object constructor: `login = SampleLoginPage(...)`
    po_vars: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            fn = node.value.func
            if isinstance(fn, ast.Name) and fn.id in po_classes:
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        po_vars.add(tgt.id)

    findings: list[dict] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        attr = node.func
        method = attr.attr
        recv = attr.value
        # expect(...).matcher()
        if isinstance(recv, ast.Call) and isinstance(recv.func, ast.Name) and recv.func.id == "expect":
            base = method[4:] if method.startswith("not_") else method
            if base not in _KNOWN_MATCHERS:
                findings.append(_code_hall(f"invalid Playwright assertion matcher 'expect(...).{method}()'", "major"))
        elif isinstance(recv, ast.Name):
            if recv.id in po_vars and method not in valid_po:
                findings.append(_code_hall(f"call to non-existent page-object method '.{method}()'", "major"))
            elif recv.id == "page" and method not in (_KNOWN_PAGE | _KNOWN_LOCATOR):
                findings.append(_code_hall(f"call to non-existent Playwright Page method 'page.{method}()'", "major"))
    return findings


def _code_hall(text: str, severity: str) -> dict:
    return {"text": text, "severity": severity, "source": "deterministic"}


def score_hallucination(
    task: str,
    output: Mapping[str, Any],
    judge_hallucinations: Sequence[Mapping[str, Any]] | None = None,
) -> dict:
    """Return ``{score, metrics, detail}`` where ``score`` is cleanliness (0..1)."""
    findings: list[dict] = []
    if task == "automation":
        code = "\n".join(str(f.get("content", "")) for f in (output.get("files") or []))
        findings.extend(_detect_code_hallucinations(code))
    for h in (judge_hallucinations or []):
        sev = str(h.get("severity", "minor")).lower()
        sev = sev if sev in _SEVERITY_WEIGHT else "minor"
        findings.append({"text": h.get("text", ""), "severity": sev, "source": "judge"})

    severity_score = sum(_SEVERITY_WEIGHT[f["severity"]] for f in findings)
    cleanliness = 1.0 - min(1.0, severity_score / _SEVERITY_CAP)
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in _SEVERITY_WEIGHT}
    return {
        "score": round(cleanliness, 4),  # research dimension: higher = cleaner
        "metrics": {
            "hallucination_count": len(findings),
            "hallucination_severity_score": round(severity_score, 3),
            "hallucination_rate_pct": round(100 * (1 - cleanliness), 1),
        },
        "detail": {"counts_by_severity": counts, "findings": findings},
    }
