"""Unit tests for the validation gate (FR-VAL-001..004, FR-AUT-004, SEC-005).

Static checks only — ``run_collection=False`` keeps everything in-process
so no pytest subprocess, network or LLM is needed (SRS §15.1, NFR-MNT-003).
"""

from __future__ import annotations

import pytest

from app.models.schemas import ValidationIssue, ValidationReport
from app.services.validation import validate_generated_code

pytestmark = pytest.mark.unit

ALLOWED_DOMAINS = ["localhost", "127.0.0.1"]

# The evil snippet is assembled at runtime so this test file itself never
# contains a literal hard-coded credential (SEC-007 hygiene). The validated
# string DOES contain one.
EVIL_SNIPPET = "\n".join(
    [
        "import os",
        "import time",
        "",
        "",
        "def test_evil(page):",
        "    " + "pass" + 'word = "SuperSecret123!"',
        "    time.sleep(5)",
        '    os.system("echo pwned")',
        '    page.goto("http://evil.example.org/login")',
    ]
)

CLEAN_SNIPPET = "\n".join(
    [
        '"""Generated login test."""',
        "",
        "from playwright.sync_api import Page, expect",
        "",
        "",
        "def test_login_valid(page: Page) -> None:",
        '    page.goto("http://localhost:8001/login")',
        '    page.get_by_test_id("username").fill("demo-user")',
        '    page.get_by_role("button", name="Log in").click()',
        '    expect(page.get_by_test_id("flash")).to_contain_text("Welcome")',
    ]
)


def _error_checks(report: ValidationReport) -> set[str]:
    return {issue.check for issue in report.issues if issue.severity == "error"}


@pytest.fixture(scope="module")
def report() -> ValidationReport:
    files = [{"path": "automation/generated_tests/test_evil.py", "content": EVIL_SNIPPET}]
    return validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)


class TestEvilSnippet:
    def test_gate_fails(self, report):
        assert report.passed is False

    def test_fixed_sleep_flagged(self, report):
        # FR-AUT-004: time.sleep is an error.
        assert "sleeps" in _error_checks(report)

    def test_forbidden_call_flagged(self, report):
        # FR-VAL-003: os.system is forbidden.
        assert "forbidden" in _error_checks(report)
        assert any("os.system" in i.message for i in report.errors)

    def test_hardcoded_password_flagged(self, report):
        # FR-VAL-003 / SEC-002: literal credentials fail the gate.
        assert "secrets" in _error_checks(report)

    def test_disallowed_url_flagged(self, report):
        # FR-VAL-004 / SEC-003: URL outside the allow-list fails the gate.
        assert "domains" in _error_checks(report)
        assert any("evil.example.org" in i.message for i in report.errors)

    def test_secret_value_never_echoed_in_report(self, report):
        # SEC-007: the report must not leak the credential value.
        dumped = report.model_dump_json()
        assert "SuperSecret123!" not in dumped


class TestCleanSnippet:
    def test_clean_playwright_code_passes(self):
        files = [{"path": "automation/generated_tests/test_login.py", "content": CLEAN_SNIPPET}]
        report = validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)
        assert report.passed is True
        assert report.errors == []


class TestPassedLogic:
    def test_syntax_error_fails_gate(self):
        files = [{"path": "automation/generated_tests/test_broken.py", "content": "def test_(:\n"}]
        report = validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)
        assert not report.passed
        assert "syntax" in _error_checks(report)

    def test_warnings_alone_do_not_fail_gate(self):
        # .nth() is a brittle-locator WARNING (FR-AUT-003), not an error.
        code = CLEAN_SNIPPET + '\n\n\ndef test_rows(page: Page) -> None:\n    page.goto("http://localhost:8001/items")\n    page.get_by_test_id("item").nth(0).click()\n'
        files = [{"path": "automation/generated_tests/test_rows.py", "content": code}]
        report = validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)
        assert any(i.severity == "warning" for i in report.issues)
        assert report.passed is True

    def test_absolute_path_rejected(self):
        # SRS §13.1: model-chosen paths must stay repo-relative.
        files = [{"path": "/etc/test_escape.py", "content": CLEAN_SNIPPET}]
        report = validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)
        assert not report.passed
        assert "forbidden" in _error_checks(report)

    def test_path_traversal_rejected(self):
        files = [{"path": "../outside/test_escape.py", "content": CLEAN_SNIPPET}]
        report = validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)
        assert not report.passed

    def test_report_errors_property_filters_severity(self):
        report = ValidationReport(
            passed=False,
            issues=[
                ValidationIssue(check="locators", severity="warning", message="brittle"),
                ValidationIssue(check="sleeps", severity="error", message="time.sleep"),
            ],
        )
        assert [i.check for i in report.errors] == ["sleeps"]

    def test_accepts_generatedfile_models(self):
        from app.models.schemas import GeneratedFile

        files = [
            GeneratedFile(path="automation/generated_tests/test_ok.py", content=CLEAN_SNIPPET)
        ]
        report = validate_generated_code(files, ALLOWED_DOMAINS, run_collection=False)
        assert report.passed
