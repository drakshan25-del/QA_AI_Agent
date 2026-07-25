"""Task-runner contract shared by the three generative tasks.

A runner is a thin, uniform wrapper around one existing agent: it injects the
model under test (:func:`evaluation.runtime.use_model`), measures wall-clock
latency, captures token usage, serialises the output for persistence, and — key
for the "where do models fail" research question — converts any generation
failure into a recorded ``status="failed"`` result rather than crashing the run.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.runtime import use_model


@dataclass
class RunResult:
    """Outcome of one task generation for one model on one benchmark item."""

    task: str
    status: str  # "ok" | "failed"
    output: Any = None  # the validated agent output object (None on failure)
    output_dict: dict = field(default_factory=dict)  # serialisable form
    raw_text: str = ""  # human-readable artefact for evidence/persistence
    latency_s: float = 0.0
    tokens: dict = field(default_factory=dict)  # tokens_prompt/completion/total, llm_calls
    retries: int = 0  # inferred from llm_calls - 1
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == "ok"


class TaskRunner(ABC):
    """Base class: subclasses implement :meth:`_generate` only."""

    #: Task key persisted in the store; set by each subclass.
    task: str = ""

    def run(self, item: BenchmarkItem, model_tag: str) -> RunResult:
        """Generate the task artefact for ``item`` using ``model_tag``.

        Never raises for model/generation errors — those are captured as a
        failed :class:`RunResult` so a single bad (model, item) pair does not
        abort the whole experiment.
        """
        sink: dict[str, Any] = {}
        started = perf_counter()
        try:
            with use_model(model_tag, sink):
                output = self._generate(item)
            latency = perf_counter() - started
            output_dict, raw_text = self._serialise(output)
            return RunResult(
                task=self.task,
                status="ok",
                output=output,
                output_dict=output_dict,
                raw_text=raw_text,
                latency_s=latency,
                tokens=dict(sink),
                retries=max(0, int(sink.get("llm_calls") or 1) - 1),
            )
        except Exception as exc:  # noqa: BLE001 - failure is a recorded finding
            latency = perf_counter() - started
            return RunResult(
                task=self.task,
                status="failed",
                latency_s=latency,
                tokens=dict(sink),
                retries=max(0, int(sink.get("llm_calls") or 1) - 1),
                error=f"{type(exc).__name__}: {exc}",
            )

    @abstractmethod
    def _generate(self, item: BenchmarkItem) -> Any:  # noqa: ANN401
        """Call the underlying agent and return its validated output object."""

    @abstractmethod
    def _serialise(self, output: Any) -> tuple[dict, str]:  # noqa: ANN401
        """Return ``(output_dict, raw_text)`` for persistence/evidence."""
