"""Unit tests for the engine's materialise ownership guard (AIQA-EXEC-003).

A run submission carries approved generated files; the engine may create and
update files it wrote itself, but must never overwrite hand-written framework
files (the instrumented BasePage, committed page objects) — a generated
``base_page.py`` artifact once shadowed the real BasePage and broke every UI
test with AttributeErrors.
"""

from __future__ import annotations

import json

import pytest

from engine.service import execution

pytestmark = pytest.mark.unit


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    """Point the engine's repo root at a scratch directory."""
    monkeypatch.setattr(execution, "REPO_ROOT", tmp_path)
    (tmp_path / "automation" / "pages").mkdir(parents=True)
    return tmp_path


def _manifest(workspace) -> dict:
    path = workspace / "automation" / ".materialised.json"
    return json.loads(path.read_text()) if path.exists() else {"files": {}}


class TestMaterialiseOwnership:
    def test_new_file_written_and_tracked(self, workspace):
        written, kept = execution.materialise_files(
            [{"path": "automation/generated_tests/test_a.py", "content": "x = 1\n"}]
        )
        assert written == ["automation/generated_tests/test_a.py"]
        assert kept == []
        assert (workspace / "automation/generated_tests/test_a.py").read_text() == "x = 1\n"
        assert "automation/generated_tests/test_a.py" in _manifest(workspace)["files"]

    def test_hand_written_file_is_kept_not_overwritten(self, workspace):
        target = workspace / "automation/pages/base_page.py"
        target.write_text("class BasePage: ...  # real, instrumented\n")
        written, kept = execution.materialise_files(
            [{"path": "automation/pages/base_page.py", "content": "# placeholder\n"}]
        )
        assert written == []
        assert kept == ["automation/pages/base_page.py"]
        assert "real, instrumented" in target.read_text()

    def test_engine_owned_file_can_be_updated(self, workspace):
        f = {"path": "automation/pages/items_page.py", "content": "v1\n"}
        execution.materialise_files([f])
        written, kept = execution.materialise_files(
            [{"path": "automation/pages/items_page.py", "content": "v2\n"}]
        )
        assert written == ["automation/pages/items_page.py"]
        assert kept == []
        assert (workspace / "automation/pages/items_page.py").read_text() == "v2\n"

    def test_externally_modified_file_is_kept(self, workspace):
        f = {"path": "automation/pages/items_page.py", "content": "v1\n"}
        execution.materialise_files([f])
        (workspace / "automation/pages/items_page.py").write_text("edited by hand\n")
        written, kept = execution.materialise_files(
            [{"path": "automation/pages/items_page.py", "content": "v2\n"}]
        )
        assert written == []
        assert kept == ["automation/pages/items_page.py"]
        assert (workspace / "automation/pages/items_page.py").read_text() == "edited by hand\n"

    def test_identical_existing_file_is_claimed(self, workspace):
        target = workspace / "automation/pages/items_page.py"
        target.write_text("same\n")
        written, kept = execution.materialise_files(
            [{"path": "automation/pages/items_page.py", "content": "same\n"}]
        )
        assert written == ["automation/pages/items_page.py"]
        assert kept == []
        # Claimed: a later updated version may overwrite it.
        written, kept = execution.materialise_files(
            [{"path": "automation/pages/items_page.py", "content": "updated\n"}]
        )
        assert written == ["automation/pages/items_page.py"]
        assert target.read_text() == "updated\n"

    def test_path_traversal_still_refused(self, workspace):
        with pytest.raises(ValueError, match="escapes the workspace"):
            execution.materialise_files(
                [{"path": "automation/../engine/service/main.py", "content": "x"}]
            )
        with pytest.raises(ValueError, match="outside the allowed roots"):
            execution.materialise_files([{"path": "engine/service/evil.py", "content": "x"}])


class TestAllSkippedError:
    def test_all_skipped_run_gets_reason(self):
        metrics = {"total": 3, "skipped": 3, "passed": 0, "failed": 0}
        tests = [
            {"node_id": "t1", "outcome": "skipped", "message": "target app not running"},
            {"node_id": "t2", "outcome": "skipped", "message": "target app not running"},
            {"node_id": "t3", "outcome": "skipped", "message": ""},
        ]
        message = execution._all_skipped_error(metrics, tests)
        assert message is not None
        assert "All 3 test(s) were skipped" in message
        assert "target app not running" in message
        assert "base URL" in message

    def test_partially_skipped_run_is_not_flagged(self):
        assert (
            execution._all_skipped_error(
                {"total": 3, "skipped": 2, "passed": 1, "failed": 0}, []
            )
            is None
        )

    def test_empty_run_is_not_flagged(self):
        assert execution._all_skipped_error({"total": 0, "skipped": 0}, []) is None
