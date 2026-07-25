"""Versioned scoring rubric — the single source of truth for how scores blend.

Keeping weights here (and persisting ``RUBRIC_VERSION`` with every run) means a
result can always be re-interpreted against the exact rubric that produced it,
and the rubric can evolve for later weeks without silently invalidating old
data. All sub-scores are on a 0..1 scale before blending.

The blend is *weighted mean over the sub-scores that are present*: if a
sub-score is missing (judge disabled, pytest collection skipped, execution not
run), its weight is dropped and the rest renormalise — so a run is never
penalised for a dimension that was not measured.
"""

from __future__ import annotations

from collections.abc import Mapping

#: Bump when any weight or dimension changes.
RUBRIC_VERSION = "v1"

#: Per-task blend weights. Keys must match the sub-score keys produced by
#: ``deterministic`` (det) and ``judge`` (judge_*).
WEIGHTS: dict[str, dict[str, float]] = {
    "test_plan": {
        "section_completeness": 0.30,  # all §8.4 sections populated (FR-TP-001)
        "type_coverage": 0.20,          # expected test types justified (FR-TP-002)
        "judge_correctness": 0.25,      # grounded, no invented features (hallucination)
        "judge_coverage": 0.20,         # checklist scenarios addressed
        "judge_readability": 0.05,
    },
    "test_cases": {
        "requirement_coverage": 0.18,   # traceability to the requirement (FR-TC-006)
        "category_diversity": 0.15,     # positive/negative/boundary/… spread (FR-TC-003)
        "field_completeness": 0.15,     # no empty §8.5 fields (FR-TC-002)
        "non_duplication": 0.10,        # few near-duplicate cases (FR-TC-004)
        "judge_coverage": 0.20,         # checklist scenarios covered
        "judge_correctness": 0.17,      # steps↔expected valid & grounded
        "judge_readability": 0.05,
    },
    "automation": {
        "gate_pass": 0.35,              # passes the REAL validation gate (SEC-005)
        "collection_success": 0.15,     # pytest can collect the files (FR-VAL-002)
        "execution_success": 0.15,      # tests actually run/pass (opt-in)
        "judge_correctness": 0.25,      # test logic faithful to the cases
        "judge_readability": 0.10,
    },
}

#: How the per-model overall score blends accuracy, speed and satisfaction.
#: Satisfaction is absent until the user study; when absent its weight is
#: dropped and accuracy/speed renormalise (see :func:`blend_overall`).
OVERALL_WEIGHTS = {"accuracy": 0.60, "speed": 0.15, "satisfaction": 0.25}

#: The Overall RESEARCH score — the enhancement's headline metric — blends all
#: ten research-grade dimensions. All are 0..1 and "higher is better" (the
#: hallucination dimension is passed as *cleanliness* = 1 − severity). Weights
#: are intentionally editable so future experiments can re-weight without code
#: changes; absent dimensions drop out and the rest renormalise. Explainability
#: and Robustness are reported separately (not folded into this headline score).
RESEARCH_SCORE_WEIGHTS = {
    "accuracy": 0.20,
    "completeness": 0.12,
    "requirement_coverage": 0.12,
    "hallucination": 0.12,        # cleanliness (1 − severity); higher = fewer/softer hallucinations
    "consistency": 0.10,
    "executability": 0.10,
    "code_quality": 0.10,
    "speed": 0.05,
    "satisfaction": 0.05,
    "reliability": 0.04,
}


def _weighted_present(scores: Mapping[str, float], weights: Mapping[str, float]) -> float | None:
    """Weighted mean over keys present in both ``scores`` and ``weights``.

    Returns None if no weighted sub-score is available (nothing measured).
    """
    num = 0.0
    den = 0.0
    for key, weight in weights.items():
        value = scores.get(key)
        if value is None:
            continue
        num += weight * float(value)
        den += weight
    return (num / den) if den > 0 else None


def blend_accuracy(task: str, sub_scores: Mapping[str, float]) -> float | None:
    """Blend deterministic + judge sub-scores into a 0..1 accuracy for ``task``.

    Args:
        task: One of the keys in :data:`WEIGHTS`.
        sub_scores: Merged mapping of deterministic and ``judge_*`` sub-scores
            (0..1). Absent dimensions are ignored (weights renormalise).
    """
    if task not in WEIGHTS:
        raise KeyError(f"no rubric weights for task '{task}'")
    return _weighted_present(sub_scores, WEIGHTS[task])


def blend_overall(
    accuracy: float | None,
    speed: float | None,
    satisfaction: float | None = None,
) -> float | None:
    """Blend the top-level per-(model,task) dimensions into one 0..1 score."""
    present = {
        "accuracy": accuracy,
        "speed": speed,
        "satisfaction": satisfaction,
    }
    return _weighted_present(
        {k: v for k, v in present.items() if v is not None}, OVERALL_WEIGHTS
    )


def blend_research_score(scores: Mapping[str, float]) -> float | None:
    """Blend the ten research dimensions into the 0..1 Overall Research Score.

    Args:
        scores: Mapping of any subset of :data:`RESEARCH_SCORE_WEIGHTS` keys to
            0..1 values (``hallucination`` passed as cleanliness = 1 − severity).
            Absent dimensions are ignored and the remaining weights renormalise.
    """
    return _weighted_present(scores, RESEARCH_SCORE_WEIGHTS)
