"""Structured, queryable storage for evaluation results.

Results are persisted to a *separate* SQLite database (``eval_results.sqlite``)
so the experiment never touches the application's operational database. SQLite
keeps the baseline reproducible on a laptop with no external services, and the
schema is trivially exportable to CSV/JSON for statistical analysis (a Week-3
deliverable) and PostgreSQL-portable for later scale.
"""

from __future__ import annotations

from evaluation.store.db import EvalStore

__all__ = ["EvalStore"]
