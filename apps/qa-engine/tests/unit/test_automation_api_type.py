"""Unit tests for API-type automation generation support (FR-AUT-001 ext).

Covers the deterministic halves of the feature — test-type validation,
required-marker enforcement and the api-style (no-browser) gate — without
touching Ollama. LLM-dependent behaviour stays in integration tests.
"""

from __future__ import annotations

import pytest

from agents.automation_agent import (
    TEST_TYPES,
    _apply_required_markers,
    _ensure_api_style,
    _ensure_parses,
    generate_automation,
)
from app.models.schemas import GeneratedFile

pytestmark = pytest.mark.unit


API_TEST = (
    "import pytest\n"
    "\n"
    "pytestmark = [pytest.mark.generated, pytest.mark.api]\n"
    "\n"
    "\n"
    "# TC: TC-101 Login API accepts valid credentials\n"
    "# REQ: REQ-7\n"
    "def test_api_login_ok(api_client, credentials, target_available) -> None:\n"
    "    response = api_client.post('/api/login', json={'username': credentials.username, 'password': credentials.password})\n"
    "    assert response.status_code == 200\n"
)


class TestTestTypeValidation:
    def test_supported_types(self):
        assert TEST_TYPES == ("ui", "api")

    def test_unknown_type_raises_before_llm(self):
        with pytest.raises(ValueError, match="unsupported test_type"):
            generate_automation([], "http://localhost", "", test_type="visual")


class TestApplyRequiredMarkers:
    def test_existing_pytestmark_gains_missing_marks(self):
        f = GeneratedFile(path="automation/generated_tests/test_x.py", kind="test_file",
                          content="import pytest\n\npytestmark = [pytest.mark.generated]\n")
        _apply_required_markers([f], ["generated", "api", "regression"])
        assert "pytest.mark.api" in f.content
        assert "pytest.mark.regression" in f.content
        assert f.content.count("pytestmark") == 1

    def test_complete_pytestmark_untouched(self):
        f = GeneratedFile(path="automation/generated_tests/test_x.py", kind="test_file",
                          content=API_TEST)
        before = f.content
        _apply_required_markers([f], ["generated", "api"])
        assert f.content == before

    def test_missing_pytestmark_inserted_after_imports(self):
        f = GeneratedFile(path="automation/generated_tests/test_x.py", kind="test_file",
                          content="import pytest\n\n\ndef test_a(api_client):\n    assert True\n")
        _apply_required_markers([f], ["generated", "api"])
        lines = f.content.splitlines()
        idx = next(i for i, line in enumerate(lines) if line.startswith("pytestmark"))
        assert idx > lines.index("import pytest")
        assert "pytest.mark.generated, pytest.mark.api" in lines[idx]

    def test_page_objects_left_alone(self):
        f = GeneratedFile(path="automation/pages/x_page.py", kind="page_object",
                          content="class XPage:\n    pass\n")
        _apply_required_markers([f], ["generated"])
        assert "pytestmark" not in f.content


class TestEnsureParses:
    def test_valid_file_passes(self):
        f = GeneratedFile(path="automation/generated_tests/test_ok.py", kind="test_file",
                          content=API_TEST)
        _ensure_parses([f])  # must not raise

    def test_truncated_file_rejected(self):
        f = GeneratedFile(path="automation/generated_tests/test_cut.py", kind="test_file",
                          content="def test_a(api_client):\n    response = api_client.post(\n        \"/api/login\n")
        with pytest.raises(ValueError, match="does not parse"):
            _ensure_parses([f])


class TestEnsureApiStyle:
    def test_clean_api_file_passes(self):
        f = GeneratedFile(path="automation/generated_tests/test_api_x.py", kind="test_file",
                          content=API_TEST)
        _ensure_api_style([f])  # must not raise

    def test_playwright_import_rejected(self):
        f = GeneratedFile(path="automation/generated_tests/test_api_x.py", kind="test_file",
                          content="from playwright.sync_api import Page\n\ndef test_a(page):\n    pass\n")
        with pytest.raises(ValueError, match="must not use playwright"):
            _ensure_api_style([f])

    def test_page_fixture_rejected(self):
        f = GeneratedFile(path="automation/generated_tests/test_api_x.py", kind="test_file",
                          content="import pytest\n\ndef test_a(page, api_client):\n    pass\n")
        with pytest.raises(ValueError, match="must not use playwright"):
            _ensure_api_style([f])
