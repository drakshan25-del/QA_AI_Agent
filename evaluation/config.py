"""Central, configuration-driven settings for the evaluation framework.

Everything that defines *an experiment* lives here so a run is fully described
by an :class:`EvalConfig` value (reproducibility, NFR-EXP-001). The CLI builds
one of these from flags; tests build one directly. No experiment parameter is
hard-coded deep in the harness.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from evaluation.models import DEFAULT_JUDGE_MODEL, default_model_names

#: Repository root (…/QA_AI_Agents), resolved from this file's location.
REPO_ROOT = Path(__file__).resolve().parent.parent
EVAL_ROOT = REPO_ROOT / "evaluation"

#: The three generative tasks under evaluation, in pipeline order.
TASKS: tuple[str, ...] = ("test_plan", "test_cases", "automation")

#: Default filesystem locations (kept out of the app's own dirs where sensible).
DEFAULT_DB_PATH = REPO_ROOT / "eval_results.sqlite"
DEFAULT_BENCHMARK_DIR = EVAL_ROOT / "benchmark" / "data"
DEFAULT_RAW_DIR = REPO_ROOT / "artifacts" / "evaluation"
DEFAULT_EXPORT_DIR = REPO_ROOT / "reports" / "evaluation"


@dataclass
class EvalConfig:
    """A complete, serialisable description of one evaluation experiment.

    Attributes:
        models: Registered model names to evaluate (defaults to all pre-trained).
        tasks: Subset of :data:`TASKS` to run.
        repetitions: Runs per (model × task × item). LLMs are stochastic even at
            low temperature, so N>1 lets us report mean ± variance.
        temperature: Sampling temperature held fixed across models for fairness.
        judge_model: Held-out judge for the LLM-as-judge accuracy dimension.
        use_judge: If False, only deterministic metrics are computed (fully
            offline, e.g. for CI or when the cloud judge is unreachable).
        run_collection: Run pytest ``--collect-only`` inside the automation gate.
        run_execution: Also execute generated tests against the sample app
            (":8001") for a real "execution success" signal (opt-in; slower).
        db_path / benchmark_dir / raw_dir / export_dir: I/O locations.
    """

    models: list[str] = field(default_factory=default_model_names)
    tasks: tuple[str, ...] = TASKS
    repetitions: int = 3
    temperature: float = 0.1
    judge_model: str = DEFAULT_JUDGE_MODEL
    use_judge: bool = True
    run_collection: bool = True
    run_execution: bool = False
    # Enhancement (research metrics)
    embedding_model: str = "nomic-embed-text:latest"  # local; powers semantic Consistency
    robustness: bool = False                          # opt-in prompt-perturbation mode
    skip_slow_models: bool = False                    # drop models in SLOW_MODELS from multi-run work
    max_reps_per_model: dict[str, int] = field(default_factory=dict)  # per-model rep cap, e.g. deepseek→1
    db_path: Path = DEFAULT_DB_PATH
    benchmark_dir: Path = DEFAULT_BENCHMARK_DIR
    raw_dir: Path = DEFAULT_RAW_DIR
    export_dir: Path = DEFAULT_EXPORT_DIR

    def reps_for(self, model_name: str) -> int:
        """Effective repetition count for a model (honours per-model caps)."""
        return max(1, min(self.repetitions, self.max_reps_per_model.get(model_name, self.repetitions)))

    def validate(self) -> None:
        """Fail fast on obviously-invalid experiment parameters."""
        if self.repetitions < 1:
            raise ValueError("repetitions must be >= 1")
        bad_tasks = [t for t in self.tasks if t not in TASKS]
        if bad_tasks:
            raise ValueError(f"unknown task(s) {bad_tasks}; valid: {TASKS}")
        if not self.models:
            raise ValueError("no models selected for evaluation")

    def ensure_dirs(self) -> None:
        """Create output directories so writers never race on a missing parent."""
        for d in (self.raw_dir, self.export_dir, self.db_path.parent):
            d.mkdir(parents=True, exist_ok=True)
