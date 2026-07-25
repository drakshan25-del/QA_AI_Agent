"""Task runners: one uniform wrapper per generative agent.

``get_runner(task)`` maps a task key to its runner so the harness stays generic
and adding a task later is a one-line registry change.
"""

from __future__ import annotations

from evaluation.runners.automation_runner import AutomationRunner
from evaluation.runners.base import RunResult, TaskRunner
from evaluation.runners.test_case_runner import TestCaseRunner
from evaluation.runners.test_plan_runner import TestPlanRunner

_RUNNERS: dict[str, type[TaskRunner]] = {
    "test_plan": TestPlanRunner,
    "test_cases": TestCaseRunner,
    "automation": AutomationRunner,
}


def get_runner(task: str) -> TaskRunner:
    """Instantiate the runner for ``task`` or raise ``KeyError``."""
    if task not in _RUNNERS:
        raise KeyError(f"no runner for task '{task}'; known: {sorted(_RUNNERS)}")
    return _RUNNERS[task]()


__all__ = ["RunResult", "TaskRunner", "get_runner"]
