"""Metrics: how a generated artefact is scored.

Three layers, in decreasing order of objectivity:

1. ``deterministic`` — reuses the system's own validation gate and quality
   helpers (validity, coverage, completeness, duplicates). Bias-free, offline.
2. ``judge`` — a held-out LLM scores subjective quality the code cannot judge
   (correctness/groundedness, scenario coverage, readability).
3. ``satisfaction`` — SUS + Likert instrument for the later human study.

``rubric`` defines the versioned weights that blend (1) and (2) into a per-task
accuracy score; ``aggregate`` rolls runs up for the dashboard/export.
"""

from __future__ import annotations
