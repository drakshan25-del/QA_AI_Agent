"""Robustness — output-quality stability under prompt perturbations.

Research purpose: a dependable QA assistant should give consistent-quality output
when the same requirement is phrased differently (paraphrased, terse, verbose, or
missing optional detail). Robustness runs each benchmark item's pre-authored
variants (opt-in, `--robustness`), scores each variant's quality (deterministic
accuracy + completeness, kept offline for speed), and reports how *stable* that
quality is: robustness = max(0, 1 − 2·σ) over the variant qualities (σ = 0.5 → 0).

Anchors: perturbation/invariance testing (e.g. metamorphic and adversarial-
paraphrase robustness studies for LLMs). This module holds the pure math; the
harness orchestrates the variant generations.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence


def quality(accuracy: float | None, completeness: float | None) -> float | None:
    """Combine a variant's deterministic accuracy and completeness into one 0..1 value."""
    vals = [v for v in (accuracy, completeness) if v is not None]
    return sum(vals) / len(vals) if vals else None


def robustness_score(qualities: Sequence[float | None]) -> float | None:
    """Stability of quality across variants: ``max(0, 1 − 2·σ)``.

    Returns None if fewer than two variant qualities are available (nothing to
    compare). Failed variants should be passed as 0.0 so instability from
    outright failure is penalised.
    """
    q = [x for x in qualities if x is not None]
    if len(q) < 2:
        return None
    return round(max(0.0, 1.0 - 2.0 * statistics.pstdev(q)), 4)
