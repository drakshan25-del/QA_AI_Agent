"""Transparent locator scoring and ranking (§12).

Scoring is deliberately explainable rather than learned: each adjustment is a
named rule with a fixed weight, and the reason is recorded on the candidate so
the Analysis page can show *why* a locator was recommended. The base score
comes from the strategy (how well the locator survives UI change) and the
adjustments come from what validation actually observed on the page.
"""

from __future__ import annotations

from typing import Any

from engine.uiscanner.locator_generator import is_dynamic_id, is_random_class
from engine.uiscanner.types import LocatorCandidate

#: Named adjustments (§12). Positive = more trustworthy.
ADJUSTMENTS: dict[str, float] = {
    "unique_match": 25,
    "role_match": 10,
    "name_match": 10,
    "visibility_match": 5,
    "enabled_match": 3,
    "correct_parent_context": 10,
    "testing_contract": 8,
    "extra_match": -10,  # per additional match
    "zero_matches": -100,
    "dynamic_id": -30,
    "random_class": -30,
    "index_based": -35,
    "absolute_xpath": -80,
    "very_long_selector": -20,
}

#: Selector length above which a locator is considered brittle.
LONG_SELECTOR_CHARS = 120

#: Score that maps to zero confidence, and the span mapped onto 0..1.
_CONFIDENCE_FLOOR = 20.0
_CONFIDENCE_SPAN = 130.0
#: A non-unique locator can never be presented as high confidence.
_NON_UNIQUE_CONFIDENCE_CAP = 0.5


def _selector_text(data: dict[str, Any]) -> str:
    """Every selector string in a (possibly scoped) locator description."""
    parts: list[str] = []
    for key in ("selector", "value", "name"):
        value = data.get(key)
        if isinstance(value, str):
            parts.append(value)
    for key in ("parent", "child"):
        nested = data.get(key)
        if isinstance(nested, dict):
            parts.append(_selector_text(nested))
    return " ".join(p for p in parts if p)


def score_candidate(
    candidate: LocatorCandidate, element: dict[str, Any]
) -> LocatorCandidate:
    """Apply every scoring rule to one validated candidate (mutates + returns)."""
    score = candidate.base_score
    data = candidate.locator_data
    strategy = candidate.strategy
    selector = _selector_text(data)

    if candidate.match_count == 0:
        score += ADJUSTMENTS["zero_matches"]
        candidate.reasons.append("Penalised: the locator matched nothing")
    elif candidate.unique:
        score += ADJUSTMENTS["unique_match"]
        candidate.reasons.append("Bonus: matched exactly one element")
    elif candidate.match_count > 1:
        extra = candidate.match_count - 1
        score += ADJUSTMENTS["extra_match"] * extra
        candidate.reasons.append(
            f"Penalised: {extra} additional element(s) also match this locator"
        )

    if candidate.role_match:
        score += ADJUSTMENTS["role_match"]
        candidate.reasons.append("Bonus: the matched element has the expected role")
    if candidate.name_match:
        score += ADJUSTMENTS["name_match"]
        candidate.reasons.append("Bonus: the accessible name matches")
    if candidate.visible_match:
        score += ADJUSTMENTS["visibility_match"]
        candidate.reasons.append("Bonus: visibility matches the scanned state")
    if candidate.enabled_match:
        score += ADJUSTMENTS["enabled_match"]
        candidate.reasons.append("Bonus: enabled state matches the scanned state")

    if strategy == "scopedRole":
        score += ADJUSTMENTS["correct_parent_context"]
        candidate.reasons.append("Bonus: scoped to the element's own container")
    if strategy == "testId":
        score += ADJUSTMENTS["testing_contract"]
        candidate.reasons.append("Bonus: uses an explicit testing contract attribute")

    # Structural fragility.
    element_id = (element.get("id") or "").strip()
    if strategy == "css" and element_id and f'id="{element_id}"' in selector:
        dynamic, why = is_dynamic_id(element_id)
        if dynamic:
            score += ADJUSTMENTS["dynamic_id"]
            candidate.reasons.append(f"Penalised: the id looks generated ({why})")
    if "." in selector and strategy == "css":
        classes = [c for c in selector.split(".")[1:] if c]
        if any(is_random_class(c) for c in classes):
            score += ADJUSTMENTS["random_class"]
            candidate.reasons.append(
                "Penalised: the selector relies on generated or utility class names"
            )
    if ":nth-child" in selector or ":nth-of-type" in selector or data.get("nth") is not None:
        score += ADJUSTMENTS["index_based"]
        candidate.reasons.append(
            "Penalised: index-based selection breaks when the list order changes"
        )
    if strategy == "xpath" and (
        selector.startswith("xpath=/html") or selector.startswith("/html")
    ):
        score += ADJUSTMENTS["absolute_xpath"]
        candidate.reasons.append("Penalised: absolute XPath is tied to the whole DOM tree")
    if len(selector) > LONG_SELECTOR_CHARS:
        score += ADJUSTMENTS["very_long_selector"]
        candidate.reasons.append("Penalised: the selector is very long and brittle")

    candidate.final_score = round(score, 2)
    candidate.confidence = to_confidence(score, unique=candidate.unique, valid=candidate.valid)
    return candidate


def to_confidence(score: float, *, unique: bool, valid: bool) -> float:
    """Map a final score onto a 0..1 confidence the UI can badge."""
    if not valid:
        return 0.0
    normalised = (score - _CONFIDENCE_FLOOR) / _CONFIDENCE_SPAN
    confidence = max(0.0, min(1.0, normalised))
    if not unique:
        confidence = min(confidence, _NON_UNIQUE_CONFIDENCE_CAP)
    return round(confidence, 4)


def rank_candidates(candidates: list[LocatorCandidate]) -> list[LocatorCandidate]:
    """Order candidates best-first: valid before invalid, unique before not."""
    return sorted(
        candidates,
        key=lambda c: (c.valid, c.unique, c.final_score, c.base_score),
        reverse=True,
    )


def recommend(
    candidates: list[LocatorCandidate],
) -> tuple[LocatorCandidate | None, str]:
    """Pick the locator to recommend and the element status that follows.

    A unique, semantically-confirmed locator is recommended outright. A valid
    but non-unique locator is offered for review rather than silently accepted,
    and an element with nothing valid is reported as unresolved.
    """
    ranked = rank_candidates(candidates)
    unique = [c for c in ranked if c.valid and c.unique]
    if unique:
        return unique[0], "unique"
    valid = [c for c in ranked if c.valid]
    if valid:
        return valid[0], "multiple_matches"
    if ranked:
        return None, "invalid"
    return None, "needs_review"
