"""Requirement Coverage — how many requirement units the artefact addresses.

Research purpose: directly answers "does the generated artefact cover the
functional requirements of the user story?" — a core QA-quality question. To
avoid rewarding a model for merely echoing the single requirement id, coverage
is measured against **requirement units** = the acceptance criteria + the
benchmark's coverage-checklist scenarios. Each unit is judged covered by a
deterministic signal (checklist keywords, or salient-token overlap for
acceptance criteria), so the metric is bias-free and offline. Uncovered units
are reported by id/text for error analysis.

Anchors: requirements-coverage / traceability analysis in test-generation
research; token-overlap is a transparent, reproducible proxy for "addressed".
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from evaluation.benchmark.schema import BenchmarkItem

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "is", "are", "be", "with", "for", "on", "in",
    "that", "this", "it", "as", "by", "must", "should", "when", "then", "not", "no", "same",
    "user", "users", "page", "shows", "show", "see", "sees", "than", "into", "up",
}


def _salient_tokens(text: str) -> set[str]:
    tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9_]{2,}", text.lower())
    return {t for t in tokens if t not in _STOPWORDS}


def score_coverage(task: str, raw_text: str, item: BenchmarkItem) -> dict:
    """Return ``{score, metrics, detail}`` — fraction of requirement units covered.

    ``raw_text`` is the rendered artefact (plan markdown / cases JSON / code).
    """
    haystack = (raw_text or "").lower()
    haystack_tokens = _salient_tokens(raw_text or "")

    units: list[dict] = []

    # Checklist scenarios (keyword-based coverage — the strongest signal).
    for c in item.coverage_checklist:
        if c.keywords:
            covered = any(k.lower() in haystack for k in c.keywords)
        else:
            need = _salient_tokens(c.description)
            covered = _overlap(need, haystack_tokens) >= 0.5
        units.append({"id": f"checklist:{c.id}", "text": c.description, "covered": covered})

    # Acceptance criteria (salient-token overlap).
    for i, crit in enumerate(item.requirement.acceptance_criteria):
        need = _salient_tokens(crit)
        covered = _overlap(need, haystack_tokens) >= 0.5 if need else True
        units.append({"id": f"ac:{i+1}", "text": crit, "covered": covered})

    total = len(units)
    covered_units = [u for u in units if u["covered"]]
    pct = (100.0 * len(covered_units) / total) if total else 100.0
    return {
        "score": round(len(covered_units) / total, 4) if total else 1.0,
        "metrics": {
            "requirement_units": total,
            "requirement_units_covered": len(covered_units),
            "requirement_coverage_pct": round(pct, 1),
        },
        "detail": {
            "covered": [u["id"] for u in covered_units],
            "uncovered": [{"id": u["id"], "text": u["text"]} for u in units if not u["covered"]],
        },
    }


def _overlap(need: set[str], have: set[str]) -> float:
    if not need:
        return 1.0
    return len(need & have) / len(need)
