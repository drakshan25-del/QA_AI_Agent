"""Unit tests for automation_agent.write_generated_files (FR-AUT-007).

The function had no coverage, which let an arity bug in its
``_safe_generated_path`` call (missing ``kind``) ship — every call raised
``TypeError``. These tests pin the contract: kind-aware routing (test files
to ``generated_tests``, page objects to ``automation/pages``), manifest
ownership checks, the identical-content no-op, and atomic refusal on foreign
or externally-modified files.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

import agents.automation_agent as automation_agent
from agents.automation_agent import write_generated_files
from app.models.schemas import GeneratedFile

pytestmark = pytest.mark.unit


TEST_CONTENT = "import pytest\n\npytestmark = [pytest.mark.generated]\n\n\ndef test_ok():\n    assert True\n"
PAGE_CONTENT = "class DemoPage:\n    pass\n"


@pytest.fixture()
def generated_root(monkeypatch, tmp_path):
    """Point the agent's settings at a throw-away automation tree."""
    root = tmp_path / "automation" / "generated_tests"
    root.mkdir(parents=True)
    monkeypatch.setattr(
        automation_agent,
        "get_settings",
        lambda: SimpleNamespace(generated_tests_path=root),
    )
    return root


def _manifest(root):
    return json.loads((root / ".manifest.json").read_text(encoding="utf-8"))


class TestWriteGeneratedFiles:
    def test_writes_test_file_and_updates_manifest(self, generated_root):
        written = write_generated_files(
            [
                GeneratedFile(
                    path="automation/generated_tests/test_demo.py",
                    kind="test_file",
                    content=TEST_CONTENT,
                    test_case_ids=["tc-1"],
                )
            ]
        )
        assert written == ["automation/generated_tests/test_demo.py"]
        assert (generated_root / "test_demo.py").read_text(encoding="utf-8") == TEST_CONTENT
        entry = _manifest(generated_root)["files"]["test_demo.py"]
        assert entry["test_case_ids"] == ["tc-1"]

    def test_page_object_routed_to_pages_dir(self, generated_root):
        written = write_generated_files(
            [
                GeneratedFile(
                    path="automation/pages/demo_page.py",
                    kind="page_object",
                    content=PAGE_CONTENT,
                ),
                GeneratedFile(
                    path="automation/generated_tests/test_demo.py",
                    kind="test_file",
                    content=TEST_CONTENT,
                ),
            ]
        )
        assert written == [
            "automation/pages/demo_page.py",
            "automation/generated_tests/test_demo.py",
        ]
        pages_dir = generated_root.parent / "pages"
        assert (pages_dir / "demo_page.py").read_text(encoding="utf-8") == PAGE_CONTENT
        # Page objects are tracked under a 'pages/' manifest key, never flattened
        # into the generated_tests dir (the pre-fix behaviour).
        manifest = _manifest(generated_root)["files"]
        assert "pages/demo_page.py" in manifest
        assert not (generated_root / "demo_page.py").exists()

    def test_rewrite_of_system_owned_file_allowed(self, generated_root):
        original = [
            GeneratedFile(
                path="automation/generated_tests/test_demo.py",
                kind="test_file",
                content=TEST_CONTENT,
            )
        ]
        write_generated_files(original)
        updated = TEST_CONTENT + "\n\ndef test_more():\n    assert True\n"
        write_generated_files(
            [
                GeneratedFile(
                    path="automation/generated_tests/test_demo.py",
                    kind="test_file",
                    content=updated,
                )
            ]
        )
        assert (generated_root / "test_demo.py").read_text(encoding="utf-8") == updated

    def test_identical_foreign_file_is_noop(self, generated_root):
        """Re-emitting an existing hand-written page object must not abort."""
        pages_dir = generated_root.parent / "pages"
        pages_dir.mkdir(parents=True)
        (pages_dir / "existing_page.py").write_text(PAGE_CONTENT, encoding="utf-8")
        written = write_generated_files(
            [
                GeneratedFile(
                    path="automation/pages/existing_page.py",
                    kind="page_object",
                    content=PAGE_CONTENT,
                )
            ]
        )
        assert written == ["automation/pages/existing_page.py"]
        # No ownership claimed over a file the system did not author.
        assert "pages/existing_page.py" not in _manifest(generated_root)["files"]

    def test_refuses_foreign_file_with_different_content(self, generated_root):
        (generated_root / "test_demo.py").write_text("# hand-written\n", encoding="utf-8")
        with pytest.raises(FileExistsError, match="not generated by this system"):
            write_generated_files(
                [
                    GeneratedFile(
                        path="automation/generated_tests/test_demo.py",
                        kind="test_file",
                        content=TEST_CONTENT,
                    )
                ]
            )
        # Atomic: nothing was overwritten.
        assert (generated_root / "test_demo.py").read_text(encoding="utf-8") == "# hand-written\n"

    def test_refuses_externally_modified_system_file(self, generated_root):
        write_generated_files(
            [
                GeneratedFile(
                    path="automation/generated_tests/test_demo.py",
                    kind="test_file",
                    content=TEST_CONTENT,
                )
            ]
        )
        (generated_root / "test_demo.py").write_text("# tampered\n", encoding="utf-8")
        with pytest.raises(FileExistsError, match="modified outside the system"):
            write_generated_files(
                [
                    GeneratedFile(
                        path="automation/generated_tests/test_demo.py",
                        kind="test_file",
                        content=TEST_CONTENT + "# v2\n",
                    )
                ]
            )
