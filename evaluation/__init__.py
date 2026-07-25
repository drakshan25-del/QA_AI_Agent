"""Week 3 baseline evaluation framework for pre-trained LLMs.

Why this package exists
-----------------------
The dissertation needs a *reproducible baseline* measuring how off-the-shelf
local LLMs perform on the project's three generative QA tasks (test plan, test
cases, Playwright automation) before any fine-tuning. This package wraps the
existing agents (``agents/``) and the system's own validation gate
(``app/services/validation.py``) in an experimental harness that measures
Accuracy, Speed and (later) User Satisfaction, and persists everything for
statistical analysis and comparison against a fine-tuned model in Week 4+.

Design goals: comparability (fixed inputs per task), objectivity (reuse the
real gate rather than an LLM opinion where possible), reproducibility (persist
raw outputs + full metadata, N repetitions), and non-invasiveness (the app is
never modified — model choice is injected at runtime).
"""

from __future__ import annotations

__all__ = ["__version__"]

#: Framework version, recorded with every run for reproducibility.
__version__ = "0.1.0"
