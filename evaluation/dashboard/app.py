"""Streamlit comparison dashboard: full research-grade model comparison.

Reads ``eval_results.sqlite`` and renders the comparison the dissertation needs:
an Overall Research Score ranking, a Model × Task table across every metric
(accuracy, completeness, coverage, consistency, hallucination, executability,
code quality, reliability, speed, satisfaction), a per-metric chart picker, a
failures panel, and the satisfaction ("pending") section. Fine-tuned models
appear automatically as extra rows once evaluated.

Launch:  python -m evaluation.cli dashboard   (or: streamlit run evaluation/dashboard/app.py -- --db PATH)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

from evaluation.config import DEFAULT_DB_PATH
from evaluation.metrics import satisfaction as sat
from evaluation.metrics.aggregate import build_run_frame, research_table
from evaluation.store import EvalStore

#: Metric columns shown in the Model × Task table (label → column, scale note).
_METRIC_COLS = [
    ("Accuracy", "accuracy"),
    ("Completeness", "completeness"),
    ("Coverage", "requirement_coverage"),
    ("Consistency", "consistency"),        # 0–100
    ("Hallucination(clean)", "hallucination"),
    ("Executability", "executability"),
    ("Code Quality", "code_quality"),
    ("Reliability", "reliability"),
    ("Robustness", "robustness"),
    ("Speed", "speed"),
    ("Satisfaction", "satisfaction"),
    ("Research Score", "research_score"),
]


def _db_path() -> str:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    args, _ = parser.parse_known_args(sys.argv[1:])
    return args.db


def _grouped_bar(df: pd.DataFrame, value: str, title: str, fmt: str = ".2f"):
    return (
        alt.Chart(df.dropna(subset=[value]))
        .mark_bar()
        .encode(
            x=alt.X("task:N", title=None),
            xOffset="model_name:N",
            y=alt.Y(f"{value}:Q", title=title),
            color=alt.Color("model_name:N", title="Model"),
            tooltip=["model_name", "task", alt.Tooltip(f"{value}:Q", format=fmt)],
        )
        .properties(height=320)
    )


def main() -> None:
    st.set_page_config(page_title="LLM QA — Research Comparison", layout="wide")
    db_path = _db_path()
    st.title("Pre-trained LLM Baseline — Research-Grade QA Comparison")
    st.caption(f"Source: `{db_path}` · higher is better for every metric (Consistency is 0–100, others 0–1).")

    if not Path(db_path).is_file():
        st.warning(f"No results database at `{db_path}`. Run: `python -m evaluation.cli run`.")
        st.stop()

    store = EvalStore(db_path)
    all_runs = store.fetch_runs()
    if not all_runs:
        st.warning("The results database has no runs yet. Run an evaluation batch first.")
        st.stop()

    batches = sorted({r["batch_id"] for r in all_runs}, reverse=True)
    batch = st.sidebar.selectbox("Batch", batches, index=0)
    df = build_run_frame(store, batch)
    rt = research_table(store, batch)

    # -- headline: Overall Research Score per model ----------------------
    st.subheader("Overall Research Score — model ranking")
    if not rt.empty and rt["research_score"].notna().any():
        per_model = (
            rt.groupby("model_name")["research_score"].mean().reset_index()
            .sort_values("research_score", ascending=False)
        )
        cols = st.columns(len(per_model))
        for col, (_, row) in zip(cols, per_model.iterrows()):
            val = row["research_score"]
            col.metric(row["model_name"], f"{val:.3f}" if pd.notna(val) else "–")
    else:
        st.info("Research score not available for this batch.")

    # -- Model × Task table (all metrics) --------------------------------
    st.subheader("Model × Task — all metrics")
    if not rt.empty:
        present = [(lbl, col) for lbl, col in _METRIC_COLS if col in rt.columns]
        view = rt[["model_name", "task"] + [c for _, c in present]].rename(
            columns={c: lbl for lbl, c in present}
        )
        st.dataframe(view, use_container_width=True, hide_index=True)

        # per-metric chart picker
        label = st.selectbox("Chart a metric", [lbl for lbl, _ in present], index=0)
        col = dict((lbl, c) for lbl, c in present)[label]
        st.altair_chart(_grouped_bar(rt, col, label, fmt=".1f" if col == "consistency" else ".2f"),
                        use_container_width=True)

    # -- Latency (speed context) -----------------------------------------
    if not rt.empty and "latency_s" in rt:
        st.subheader("Latency (seconds, lower is faster)")
        st.altair_chart(_grouped_bar(rt, "latency_s", "Latency (s)", fmt=".1f"), use_container_width=True)

    # -- failures --------------------------------------------------------
    failures = df[~df["ok"]] if not df.empty else df
    st.subheader(f"Failures — where models break ({len(failures)})")
    if failures.empty:
        st.success("No generation failures in this batch.")
    else:
        st.dataframe(failures[["model_name", "task", "item_id", "repetition", "error"]],
                     use_container_width=True, hide_index=True)

    # -- user satisfaction -----------------------------------------------
    st.subheader("User satisfaction (SUS + Likert)")
    sat_rows = store.fetch_satisfaction()
    if not sat_rows:
        st.info(
            "**Pending — collected in the user study.** The SUS + 5-point Likert "
            f"instrument ({len(sat.SUS_ITEMS)} SUS items + {len(sat.LIKERT_DIMENSIONS)} "
            "Likert dimensions) is implemented; no satisfaction scores are fabricated."
        )
    else:
        sdf = pd.DataFrame(sat_rows)
        st.dataframe(sdf.groupby("model_name")["sus_score"].agg(["mean", "count"]).reset_index(),
                     use_container_width=True, hide_index=True)

    with st.expander("All runs (raw)"):
        st.dataframe(df, use_container_width=True, hide_index=True)


main()
