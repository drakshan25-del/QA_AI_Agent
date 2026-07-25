"""Cohort-level aggregation for reporting.

Turns the per-run rows in the store into tidy pandas frames the dashboard and
export share. The one cohort-relative step is the **speed score**: latency is
min-max normalised *within each task* (fastest run in a task → 1.0, slowest →
0.0) so speed is comparable across tasks of very different lengths. The overall
score then blends accuracy + speed (+ satisfaction when present) via the rubric.
"""

from __future__ import annotations

import pandas as pd

from evaluation.metrics import rubric
from evaluation.store import EvalStore


def build_run_frame(store: EvalStore, batch_id: str | None = None) -> pd.DataFrame:
    """One tidy row per run, with metric_* / judge_* columns and derived scores."""
    runs = store.fetch_runs(batch_id)
    rows: list[dict] = []
    for r in runs:
        row = dict(r)
        for m in store.fetch_metrics(r["run_id"]):
            row[f"metric_{m['metric_key']}"] = m["metric_value"]
        for j in store.fetch_judgements(r["run_id"]):
            max_score = j.get("max_score") or 0
            row[f"judge_{j['dimension']}"] = (
                (j["score"] / max_score) if (j.get("score") is not None and max_score) else None
            )
        rows.append(row)

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["ok"] = df["status"] == "ok"
    df["tokens_per_s"] = [
        (t / l) if (t and l and l > 0) else None
        for t, l in zip(df.get("tokens_total"), df["latency_s"])
    ]
    df["speed_score"] = _speed_score(df)
    df["overall_score"] = [
        rubric.blend_overall(a, s, None)
        for a, s in zip(df.get("accuracy_score"), df["speed_score"])
    ]
    return df


def _speed_score(df: pd.DataFrame) -> list:
    """Min-max normalised, task-relative speed score (higher = faster)."""
    scores: dict[int, float | None] = {}
    for _task, grp in df.groupby("task"):
        ok = grp[grp["ok"]]
        lo, hi = (ok["latency_s"].min(), ok["latency_s"].max()) if not ok.empty else (None, None)
        for idx, r in grp.iterrows():
            if not r["ok"]:
                scores[idx] = None
            elif lo is None or hi == lo:
                scores[idx] = 1.0
            else:
                scores[idx] = round(1.0 - (r["latency_s"] - lo) / (hi - lo), 4)
    return [scores[i] for i in df.index]


def summarize_by_model_task(df: pd.DataFrame) -> pd.DataFrame:
    """Mean ± std over repetitions/items, per (model, task)."""
    if df.empty:
        return df
    ok = df[df["ok"]]
    grouped = (
        ok.groupby(["model_name", "model_source", "task"])
        .agg(
            n_runs=("run_id", "count"),
            accuracy_mean=("accuracy_score", "mean"),
            accuracy_std=("accuracy_score", "std"),
            latency_mean_s=("latency_s", "mean"),
            tokens_per_s_mean=("tokens_per_s", "mean"),
            speed_mean=("speed_score", "mean"),
            overall_mean=("overall_score", "mean"),
        )
        .reset_index()
    )
    return grouped.round(4)


#: Per-run metric columns folded into the research table, with their transform.
_RUN_METRIC_COLS = {
    "completeness": ("metric_completeness_pct", lambda v: v / 100.0),
    "requirement_coverage": ("metric_requirement_coverage_pct", lambda v: v / 100.0),
    "hallucination": ("metric_hallucination_rate_pct", lambda v: 1.0 - v / 100.0),  # cleanliness
    "code_quality": ("metric_code_quality", lambda v: v),
    "executability": ("metric_executability_score", lambda v: v),
}


def _ensure_columns(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Return df with any missing columns added as NaN (so agg never KeyErrors)."""
    for c in cols:
        if c not in df:
            df[c] = pd.NA
    return df


def research_table(store: EvalStore, batch_id: str | None = None) -> pd.DataFrame:
    """The dashboard/export table: one row per (model, task) with every dimension.

    Columns: accuracy, completeness, requirement_coverage, hallucination
    (cleanliness), code_quality, executability, speed, consistency (0–100),
    reliability, robustness, satisfaction (pending), research_score.
    """
    df = build_run_frame(store, batch_id)
    if df.empty:
        return df
    df = _ensure_columns(df, [c for c, _ in _RUN_METRIC_COLS.values()])
    ok = df[df["ok"]]

    grouped = ok.groupby(["model_name", "model_source", "task"])
    base = grouped.agg(
        n_runs=("run_id", "count"),
        accuracy=("accuracy_score", "mean"),
        speed=("speed_score", "mean"),
        latency_s=("latency_s", "mean"),
        **{name: (col, "mean") for name, (col, _) in _RUN_METRIC_COLS.items()},
    ).reset_index()
    for name, (_, transform) in _RUN_METRIC_COLS.items():
        base[name] = base[name].map(lambda v: transform(v) if pd.notna(v) else pd.NA)

    # Merge the cross-run aggregate metrics (task-level rows only).
    agg_rows = store.fetch_aggregate_metrics(batch_id)
    agg = pd.DataFrame(agg_rows)
    for key in ("consistency", "reliability", "robustness", "research_score"):
        if not agg.empty and (agg["metric_key"] == key).any():
            sub = agg[(agg["metric_key"] == key) & agg["task"].notna()][
                ["model_name", "task", "metric_value"]
            ].rename(columns={"metric_value": key})
            base = base.merge(sub, on=["model_name", "task"], how="left")
        else:
            base[key] = pd.NA

    base["satisfaction"] = pd.NA  # pending until the user study
    return base.round(4)


def summarize_by_model(df: pd.DataFrame) -> pd.DataFrame:
    """Grand per-model roll-up across all tasks, including a failure rate."""
    if df.empty:
        return df
    total = df.groupby("model_name").size().rename("attempts")
    failures = df[~df["ok"]].groupby("model_name").size().rename("failures")
    ok = df[df["ok"]]
    agg = (
        ok.groupby(["model_name", "model_source"])
        .agg(
            accuracy_mean=("accuracy_score", "mean"),
            latency_mean_s=("latency_s", "mean"),
            speed_mean=("speed_score", "mean"),
            overall_mean=("overall_score", "mean"),
        )
        .reset_index()
        .set_index("model_name")
    )
    out = agg.join(total).join(failures)
    out["failures"] = out["failures"].fillna(0).astype(int)
    out["failure_rate"] = (out["failures"] / out["attempts"]).round(4)
    return out.reset_index().round(4)
