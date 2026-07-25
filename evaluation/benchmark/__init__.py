"""Reusable Software-QA benchmark suite.

Each benchmark item is a fixed, versioned experiment input: a user story with a
concrete requirement and — crucially — the *fixed inputs* each task needs so
every model is measured on identical material (comparability). Ground truth is
expressed as a **coverage checklist + validity rules** rather than a single
"gold" artefact, because there are many valid test plans/cases for one story and
exact-match scoring would unfairly penalise valid-but-different outputs.

The suite is data (YAML under ``data/``) so it can be extended in later weeks
without code changes and reused unchanged for fine-tuned models.
"""

from __future__ import annotations

from evaluation.benchmark.schema import BenchmarkItem, ChecklistItem
from evaluation.benchmark.suite import load_suite

__all__ = ["BenchmarkItem", "ChecklistItem", "load_suite"]
