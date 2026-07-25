"""Task 1 runner — Test Plan generation.

Wraps ``agents.test_plan_agent.generate_test_plan`` with the fixed benchmark
inputs (one requirement, plus the item's optional fixed analysis) so every model
receives identical material.
"""

from __future__ import annotations

import json
from typing import Any

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.runners.base import TaskRunner


class TestPlanRunner(TaskRunner):
    task = "test_plan"

    def _generate(self, item: BenchmarkItem) -> Any:
        from agents.test_plan_agent import generate_test_plan

        analyses = [item.analysis] if item.analysis else []
        return generate_test_plan(
            project_name=item.project_name,
            base_url=item.base_url,
            requirements=[item.requirement_dict()],
            analyses=analyses,
        )

    def _serialise(self, output: Any) -> tuple[dict, str]:
        from agents.test_plan_agent import render_test_plan_markdown

        return output.model_dump(), render_test_plan_markdown(output)
