"""Task 2 runner — Functional Test Case generation.

Wraps ``agents.test_case_agent.generate_test_cases`` with the benchmark's fixed
requirement + optional analysis and its ``min_cases`` target.
"""

from __future__ import annotations

import json
from typing import Any

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.runners.base import TaskRunner


class TestCaseRunner(TaskRunner):
    task = "test_cases"

    def _generate(self, item: BenchmarkItem) -> Any:
        from agents.test_case_agent import generate_test_cases

        return generate_test_cases(
            requirement=item.requirement_dict(),
            analysis=item.analysis,
            min_cases=item.min_cases,
        )

    def _serialise(self, output: Any) -> tuple[dict, str]:
        data = output.model_dump()
        return data, json.dumps(data, indent=2, default=str)
