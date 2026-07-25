"""Task 3 runner — Playwright automation generation.

Wraps ``agents.automation_agent.generate_automation``. Crucially it feeds the
benchmark's **fixed** ``reference_test_cases`` (not each model's own Task-2
output), isolating "can the model write valid automation from given cases" from
"did it write good cases" — so Task 3 is comparable across models.

The page-object summary is produced by the same deterministic ``ast``
introspection the app uses (replicated here to avoid importing the FastAPI
layer), so generated code is asked to reuse the real page objects.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.config import REPO_ROOT
from evaluation.runners.base import TaskRunner

_PAGES_DIR = REPO_ROOT / "automation" / "pages"


def page_objects_summary(pages_dir: Path = _PAGES_DIR) -> str:
    """Summarise available page objects for the agent prompt (deterministic).

    Mirrors ``app.api.automation._page_objects_summary`` — pure ``ast`` parsing,
    no code execution — so the evaluation package stays decoupled from the API.
    """
    lines: list[str] = []
    for py_file in sorted(pages_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue
        module = f"automation.pages.{py_file.stem}"
        for node in tree.body:
            if not isinstance(node, ast.ClassDef):
                continue
            methods = [
                child.name
                for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                and not child.name.startswith("_")
            ]
            lines.append(
                f"- {module}.{node.name}(page, base_url) — methods: "
                f"{', '.join(methods) if methods else '(none)'}"
            )
    return "\n".join(lines) or "(no page objects available)"


class AutomationRunner(TaskRunner):
    task = "automation"

    def _generate(self, item: BenchmarkItem) -> Any:
        from agents.automation_agent import generate_automation

        if not item.reference_test_cases:
            raise ValueError(
                f"benchmark item '{item.id}' has no reference_test_cases; the "
                "automation task requires fixed input cases for comparability"
            )
        return generate_automation(
            test_cases=item.reference_test_cases,
            base_url=item.base_url,
            page_objects_summary=page_objects_summary(),
        )

    def _serialise(self, output: Any) -> tuple[dict, str]:
        data = output.model_dump()
        raw = "\n\n".join(
            f"# ── {f['path']} ──\n{f['content']}" for f in data.get("files", [])
        )
        return data, raw
