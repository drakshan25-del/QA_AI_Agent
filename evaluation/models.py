"""Model registry for the evaluation framework (configuration-driven).

Research purpose
----------------
The baseline compares three *pre-trained* local models. Later weeks add
fine-tuned / LoRA variants. To make that a data change rather than an
architecture change (a dissertation requirement — "avoid architectural changes
later"), every model is described by a :class:`ModelSpec` with a ``source``
field. Week 4 registers a new spec (``source="finetuned"``) and the entire
harness, storage and dashboard work unchanged, so pre-trained vs fine-tuned
results sit side by side.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    """A single evaluable model.

    Attributes:
        name: Canonical identifier used as the primary key in results. Kept
            stable across runs so longitudinal comparison is possible.
        ollama_tag: The tag passed to Ollama (``ollama run <tag>``). May differ
            from ``name`` once fine-tuned variants share a family.
        source: ``pretrained`` | ``finetuned`` | ``lora`` — the axis the whole
            study compares. Persisted with every run.
        family: Base architecture family (e.g. ``qwen2.5``), for grouping.
        notes: Free-text caveats surfaced in the dashboard/report.
    """

    name: str
    ollama_tag: str
    source: str = "pretrained"
    family: str = ""
    notes: str = ""
    slow: bool = False  # impractically slow for multi-run metrics (excluded by --skip-slow-models)


#: The Week-3 pre-trained baseline models (all verified present via ``ollama list``).
#: Add fine-tuned / LoRA specs here in later weeks — nothing else needs to change.
REGISTRY: dict[str, ModelSpec] = {
    "qwen2.5:latest": ModelSpec(
        name="qwen2.5:latest",
        ollama_tag="qwen2.5:latest",
        source="pretrained",
        family="qwen2.5",
        notes="General-purpose 7B instruct model; the app's current default.",
    ),
    "qwen2.5-coder:latest": ModelSpec(
        name="qwen2.5-coder:latest",
        ollama_tag="qwen2.5-coder:latest",
        source="pretrained",
        family="qwen2.5",
        notes="Code-specialised variant; hypothesised to help the automation task.",
    ),
    "deepseek-r1:8b": ModelSpec(
        name="deepseek-r1:8b",
        ollama_tag="deepseek-r1:8b",
        source="pretrained",
        family="deepseek-r1",
        slow=True,
        notes=(
            "Reasoning model that emits <think> traces; may reduce structured-output "
            "reliability/speed. Failures are recorded as findings, not hidden."
        ),
    ),
}

#: Default judge is a *held-out* model NOT under test, to avoid self-preference
#: bias in LLM-as-judge scoring. Cloud-routed; deterministic metrics do not
#: depend on it and run fully offline.
DEFAULT_JUDGE_MODEL = "qwen3.5:397b-cloud"


def get_model(name: str) -> ModelSpec:
    """Return the :class:`ModelSpec` for ``name`` or raise ``KeyError``.

    Raises:
        KeyError: If the model is not registered (fail fast rather than silently
            evaluate an unknown tag).
    """
    if name not in REGISTRY:
        raise KeyError(
            f"Unknown model '{name}'. Registered: {sorted(REGISTRY)}. "
            f"Add a ModelSpec to evaluation/models.py to evaluate it."
        )
    return REGISTRY[name]


def default_model_names() -> list[str]:
    """All registered pre-trained models — the Week-3 baseline cohort."""
    return [m.name for m in REGISTRY.values() if m.source == "pretrained"]


def slow_model_names() -> list[str]:
    """Models flagged impractically slow for multi-run metrics."""
    return [m.name for m in REGISTRY.values() if m.slow]
