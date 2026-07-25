"""Export a batch's results to CSV/JSON for dissertation analysis.

Produces three CSVs (a wide per-run table plus two roll-ups) and one JSON blob.
The wide table is the one a statistics tool (R, pandas, SPSS) consumes: one row
per run with every metric and score as a column.
"""

from __future__ import annotations

import json
from pathlib import Path

from evaluation.metrics.aggregate import (
    build_run_frame,
    research_table,
    summarize_by_model,
    summarize_by_model_task,
)
from evaluation.store import EvalStore


def export_batch(store: EvalStore, batch_id: str | None, out_dir: Path | str) -> dict[str, str]:
    """Write CSV/JSON exports for ``batch_id`` (or the latest batch).

    Returns:
        Mapping of artefact name -> written path.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    batch_id = batch_id or store.latest_batch_id()
    if not batch_id:
        raise ValueError("no batches found in the store to export")

    runs = build_run_frame(store, batch_id)
    if runs.empty:
        raise ValueError(f"no runs found for batch {batch_id}")

    by_model_task = summarize_by_model_task(runs)
    by_model = summarize_by_model(runs)
    research = research_table(store, batch_id)
    aggregate_metrics = store.fetch_aggregate_metrics(batch_id)

    paths = {
        "runs_wide": out / f"{batch_id}_runs_wide.csv",
        "research_table": out / f"{batch_id}_research_table.csv",
        "aggregate_metrics": out / f"{batch_id}_aggregate_metrics.csv",
        "summary_by_model_task": out / f"{batch_id}_summary_by_model_task.csv",
        "summary_by_model": out / f"{batch_id}_summary_by_model.csv",
        "results_json": out / f"{batch_id}_results.json",
    }
    runs.to_csv(paths["runs_wide"], index=False)
    research.to_csv(paths["research_table"], index=False)
    import pandas as pd  # local import keeps module import light
    pd.DataFrame(aggregate_metrics).to_csv(paths["aggregate_metrics"], index=False)
    by_model_task.to_csv(paths["summary_by_model_task"], index=False)
    by_model.to_csv(paths["summary_by_model"], index=False)
    paths["results_json"].write_text(
        json.dumps(
            {
                "batch_id": batch_id,
                "research_table": research.to_dict(orient="records"),
                "aggregate_metrics": aggregate_metrics,
                "summary_by_model": by_model.to_dict(orient="records"),
                "summary_by_model_task": by_model_task.to_dict(orient="records"),
                "runs": runs.to_dict(orient="records"),
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    return {k: str(v) for k, v in paths.items()}
