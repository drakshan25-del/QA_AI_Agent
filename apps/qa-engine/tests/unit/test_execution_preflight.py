"""Unit tests for the engine's execution preflight and error surfacing.

A wiped host workspace (missing ``base_page.py``) once made every headed
execution die at pytest collection with a truncated ModuleNotFoundError that
surfaced only as pytest's "valid Python names" hint. These tests pin the
guards added against that failure mode: the framework-prerequisite preflight,
the materialised-file collection-target filter, and the error excerpt that
keeps the terminal ``E ...Error`` line visible.
"""

from __future__ import annotations

import pytest

from engine.service import execution

pytestmark = pytest.mark.unit


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    """Point the engine's repo root at a scratch directory."""
    monkeypatch.setattr(execution, "REPO_ROOT", tmp_path)
    (tmp_path / "automation" / "pages").mkdir(parents=True)
    return tmp_path


def _write_framework(workspace) -> None:
    for rel in execution._FRAMEWORK_PREREQUISITES:
        path = workspace / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# framework\n")


class _FakeProc:
    """Stands in for the pytest subprocess; produces no junit report."""

    pid = 4242

    def communicate(self, timeout=None):
        return ("", "")

    def poll(self):
        return 0


class TestFrameworkPreflight:
    def test_missing_framework_fails_fast_without_spawning_pytest(
        self, workspace, monkeypatch
    ):
        def _no_spawn(*args, **kwargs):
            raise AssertionError("pytest must not be spawned when the workspace is damaged")

        monkeypatch.setattr(execution.subprocess, "Popen", _no_spawn)
        result = execution.run_execution(
            "run-preflight",
            ["automation/generated_tests/test_x.py"],
            engine_port=8100,
            engine_token="t",
        )
        assert result["status"] == "error"
        assert "automation/pages/base_page.py" in result["metrics"]["error"]
        assert "git checkout" in result["metrics"]["error"]

    def test_intact_workspace_passes_preflight(self, workspace, monkeypatch):
        _write_framework(workspace)
        monkeypatch.setattr(execution.subprocess, "Popen", lambda *a, **k: _FakeProc())
        result = execution.run_execution(
            "run-intact",
            ["automation/generated_tests/test_x.py"],
            engine_port=8100,
            engine_token="t",
        )
        # The fake process writes no junit report, so the run still errors —
        # but on the missing report, never on the preflight.
        assert "damaged" not in (result["metrics"].get("error") or "")


class TestMaterialisedTargetFilter:
    def test_page_objects_are_not_collection_targets(self, workspace, monkeypatch):
        _write_framework(workspace)
        monkeypatch.setattr(execution.subprocess, "Popen", lambda *a, **k: _FakeProc())
        test_paths = ["automation/generated_tests/test_a.py"]
        execution.run_execution(
            "run-filter",
            test_paths,
            engine_port=8100,
            engine_token="t",
            files=[
                {"path": "automation/generated_tests/test_a.py", "content": "x = 1\n"},
                {"path": "automation/generated_tests/test_b.py", "content": "x = 1\n"},
                {"path": "automation/pages/login_page.py", "content": "x = 1\n"},
            ],
        )
        assert test_paths == [
            "automation/generated_tests/test_a.py",
            "automation/generated_tests/test_b.py",
        ]


class TestPytestErrorExcerpt:
    def test_errors_section_preferred_and_terminal_line_kept(self):
        stdout = (
            "===== test session starts =====\n"
            "collected 0 items / 1 error\n\n"
            "==================================== ERRORS ====================================\n"
            "_____ ERROR collecting automation/generated_tests/test_admin_login.py _____\n"
            "ImportError while importing test module 'test_admin_login.py'.\n"
            "Hint: make sure your test modules/packages have valid Python names.\n"
            "Traceback:\n"
            "E   ModuleNotFoundError: No module named 'automation.pages.base_page'\n"
            "=========================== short test summary info ============================\n"
            "ERROR automation/generated_tests/test_admin_login.py\n"
        )
        excerpt = execution._pytest_error_excerpt(stdout)
        assert "ModuleNotFoundError" in excerpt
        assert "ERRORS" in excerpt.splitlines()[0]
        assert "test session starts" not in excerpt

    def test_fallback_picks_error_lines(self):
        stdout = "garbage\nE   AssertionError: boom\nmore garbage\n"
        assert execution._pytest_error_excerpt(stdout) == "E   AssertionError: boom"

    def test_excerpt_is_capped(self):
        stdout = "x" * 10000
        assert len(execution._pytest_error_excerpt(stdout)) == execution._ERROR_EXCERPT_CHARS
