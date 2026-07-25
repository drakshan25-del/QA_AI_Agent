"""Speed metrics.

Latency is measured directly (always available); tokens are best-effort from the
Ollama callback. A *normalised* speed score (0..1, higher = faster) is not
computed here because it is relative to the cohort — it is derived at
aggregation time in :mod:`evaluation.metrics.aggregate` where all runs are known.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def speed_metrics(latency_s: float, tokens: Mapping[str, Any]) -> dict:
    """Raw per-run speed measurements.

    Args:
        latency_s: Wall-clock generation time.
        tokens: Token sink from the runner (may be empty if the model did not
            report usage).

    Returns:
        ``{latency_s, tokens_total, tokens_per_s}`` (tokens fields may be None).
    """
    total = tokens.get("tokens_total")
    tps = (total / latency_s) if (total and latency_s and latency_s > 0) else None
    return {
        "latency_s": round(latency_s, 4),
        "tokens_total": total,
        "tokens_per_s": round(tps, 2) if tps is not None else None,
    }
