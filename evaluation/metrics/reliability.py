"""Reliability — long-term stability of a model across repeated executions.

Research purpose: a model that occasionally fails to produce valid structured
output, or needs many retries, is less dependable in a CI/CD QA pipeline even if
its successful outputs score well. Reliability aggregates the run outcomes the
harness already records (status, retries) into a success rate, failure rate and
mean retry count per (model, task), and a 0..1 reliability score.

Anchors: reliability/robustness reporting in ML-systems evaluation (success rate
over repeated trials); retries capture "effort to a valid answer".
"""

from __future__ import annotations

import pandas as pd

#: Retry count at which the retry penalty saturates.
_MAX_RETRIES = 3.0


def compute(df: pd.DataFrame) -> list[dict]:
    """Per-(model, task) reliability from the run frame (includes failed runs)."""
    if df.empty:
        return []
    out: list[dict] = []
    for (model, task), g in df.groupby(["model_name", "task"]):
        attempts = len(g)
        failures = int((~g["ok"]).sum())
        successes = attempts - failures
        success_rate = successes / attempts if attempts else 0.0
        failure_rate = failures / attempts if attempts else 0.0
        mean_retries = float(g["retries"].fillna(0).mean()) if attempts else 0.0
        retry_penalty = min(1.0, mean_retries / _MAX_RETRIES)
        score = 0.8 * success_rate + 0.2 * (1.0 - retry_penalty)
        out.append({
            "model_name": model,
            "task": task,
            "score": round(score, 4),
            "detail": {
                "attempts": attempts,
                "successes": successes,
                "failures": failures,
                "success_rate": round(success_rate, 4),
                "failure_rate": round(failure_rate, 4),
                "mean_retries": round(mean_retries, 3),
            },
        })
    return out
