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
    _documented_endpoints,
    _drop_reserved_page_objects,
    _ensure_api_style,
    _ensure_documented_endpoints,
    _ensure_no_fixed_waits,
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


API_SUMMARY = (
    "# API documentation: items-api.md\n"
    "POST /api/login — authenticate, returns 200\n"
    "GET /api/items — list items for the session user, returns 200\n"
    "POST /api/items — create an item, returns 201\n"
    "GET /api/items/{id} — fetch one item, returns 200\n"
)


class TestDocumentedEndpoints:
    def test_extracts_method_path_pairs(self):
        endpoints = _documented_endpoints(API_SUMMARY)
        assert {(m, raw) for m, raw, _ in endpoints} == {
            ("post", "/api/login"),
            ("get", "/api/items"),
            ("post", "/api/items"),
            ("get", "/api/items/{id}"),
        }

    def test_template_parameter_matches_one_segment(self):
        endpoints = _documented_endpoints("GET /api/items/{id}")
        _, _, rx = endpoints[0]
        assert rx.match("/api/items/42")
        assert rx.match("/api/items/42/")
        assert not rx.match("/api/items")
        assert not rx.match("/api/items/42/comments")

    def test_prose_without_pairs_yields_nothing(self):
        assert _documented_endpoints("The API lets users manage items.") == []


class TestEnsureDocumentedEndpoints:
    def _file(self, body: str) -> GeneratedFile:
        return GeneratedFile(
            path="automation/generated_tests/test_api_x.py",
            kind="test_file",
            content=API_TEST.replace(
                "    response = api_client.post('/api/login', json={'username': credentials.username, 'password': credentials.password})\n",
                body,
            ),
        )

    def test_documented_calls_pass(self):
        f = self._file("    response = api_client.get('/api/items/7')\n")
        _ensure_documented_endpoints([f], API_SUMMARY)  # must not raise

    def test_invented_route_rejected(self):
        f = self._file("    response = api_client.post('/api/products')\n")
        with pytest.raises(ValueError, match="POST /api/products"):
            _ensure_documented_endpoints([f], API_SUMMARY)

    def test_wrong_method_on_documented_path_rejected(self):
        f = self._file("    response = api_client.delete('/api/items')\n")
        with pytest.raises(ValueError, match="DELETE /api/items"):
            _ensure_documented_endpoints([f], API_SUMMARY)

    def test_request_style_call_checked(self):
        f = self._file("    response = api_client.request('PUT', '/api/items/7')\n")
        with pytest.raises(ValueError, match="PUT /api/items/7"):
            _ensure_documented_endpoints([f], API_SUMMARY)

    def test_gate_off_without_extractable_endpoints(self):
        f = self._file("    response = api_client.post('/api/anything')\n")
        _ensure_documented_endpoints([f], "prose only, no endpoint pairs")
        _ensure_documented_endpoints([f], "")  # no summary at all


class TestDropReservedPageObjects:
    def test_base_page_placeholder_dropped(self):
        files = [
            GeneratedFile(path="automation/pages/base_page.py", kind="page_object",
                          content="class BasePage: ...\n"),
            GeneratedFile(path="automation/pages/dashboard_page.py", kind="page_object",
                          content="class DashboardPage: ...\n"),
        ]
        _drop_reserved_page_objects(files)
        assert [f.path for f in files] == ["automation/pages/dashboard_page.py"]

    def test_init_and_conftest_dropped(self):
        files = [
            GeneratedFile(path="automation/pages/__init__.py", kind="page_object",
                          content="# init\n"),
            GeneratedFile(path="automation/pages/conftest.py", kind="page_object",
                          content="# conftest\n"),
        ]
        _drop_reserved_page_objects(files)
        assert files == []

    def test_test_files_never_dropped(self):
        files = [
            GeneratedFile(path="automation/generated_tests/test_base_page.py",
                          kind="test_file", content=API_TEST),
        ]
        _drop_reserved_page_objects(files)
        assert len(files) == 1


class TestEnsureNoFixedWaits:
    def test_clean_file_passes(self):
        f = GeneratedFile(path="automation/generated_tests/test_ok.py",
                          kind="test_file", content=API_TEST)
        _ensure_no_fixed_waits([f])  # must not raise

    def test_wait_for_timeout_rejected_at_generation_time(self):
        f = GeneratedFile(
            path="automation/generated_tests/test_slow.py", kind="test_file",
            content=(
                "def test_a(page, base_url, target_available):\n"
                "    page.goto(base_url)\n"
                "    page.wait_for_timeout(10000)\n"
            ),
        )
        with pytest.raises(ValueError, match="forbidden fixed waits"):
            _ensure_no_fixed_waits([f])

    def test_time_sleep_rejected(self):
        f = GeneratedFile(
            path="automation/generated_tests/test_sleepy.py", kind="test_file",
            content="import time\n\ndef test_a(api_client):\n    time.sleep(3)\n",
        )
        with pytest.raises(ValueError, match="forbidden fixed waits"):
            _ensure_no_fixed_waits([f])
