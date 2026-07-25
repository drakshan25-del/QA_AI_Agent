"""Deterministic metrics: exercised on hand-built fixtures (no LLM needed).

These assert the objective backbone of the accuracy score behaves as designed —
including that the automation scorer really delegates to the system's validation
gate (clean code passes, unsafe code fails).
"""

from __future__ import annotations

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.metrics import deterministic as det


def _item(**overrides) -> BenchmarkItem:
    base = {
        "id": "t", "title": "t", "project_name": "p", "base_url": "http://localhost:8001",
        "allowed_domains": ["localhost", "127.0.0.1"],
        "requirement": {"id": "REQ-X", "title": "x", "text": "requirement text"},
        "expected_test_types": ["UI", "security"],
        "expected_categories": ["positive", "negative", "boundary"],
        "coverage_checklist": [
            {"id": "valid", "description": "valid path", "keywords": ["welcome"]},
            {"id": "invalid", "description": "invalid path", "keywords": ["invalid"]},
        ],
        "min_cases": 2,
    }
    base.update(overrides)
    return BenchmarkItem.model_validate(base)


# -- Task 1 -----------------------------------------------------------------
def test_test_plan_completeness_and_type_coverage():
    full = {s: ["something"] for s in det._PLAN_SECTIONS}
    full["test_types"] = ["UI: because", "Security: because"]
    result = det.score_test_plan(full, _item())
    assert result["scores"]["section_completeness"] == 1.0
    assert result["scores"]["type_coverage"] == 1.0

    partial = {s: [] for s in det._PLAN_SECTIONS}
    partial["objectives"] = ["x"]
    partial["test_types"] = ["UI: because"]
    r2 = det.score_test_plan(partial, _item())
    assert r2["scores"]["section_completeness"] == round(2 / 10, 4)
    assert r2["scores"]["type_coverage"] == 0.5  # UI matched, security missing


# -- Task 2 -----------------------------------------------------------------
def test_test_cases_scoring():
    cases = {
        "test_cases": [
            {
                "case_key": "TC-001", "requirement_ids": ["REQ-X"], "title": "valid login",
                "objective": "welcome shown", "category": "positive", "priority": "high",
                "preconditions": ["app running"], "test_data": {"user": "demo"},
                "steps": ["open", "submit"], "expected_results": ["welcome"],
                "automation_suitability": "automatable",
            },
            {
                "case_key": "TC-002", "requirement_ids": ["REQ-X"], "title": "invalid password",
                "objective": "error shown", "category": "negative", "priority": "high",
                "preconditions": ["app running"], "test_data": {"user": "demo"},
                "steps": ["open", "submit wrong"], "expected_results": ["invalid"],
                "automation_suitability": "automatable",
            },
        ]
    }
    r = det.score_test_cases(cases, _item())
    assert r["scores"]["requirement_coverage"] == 1.0          # both trace REQ-X
    assert r["scores"]["category_diversity"] == round(2 / 3, 4)  # positive+negative of 3 expected
    assert r["scores"]["field_completeness"] == 1.0            # all fields substantive
    assert r["scores"]["non_duplication"] == 1.0               # distinct cases
    assert r["detail"]["checklist_keyword_coverage"]["value"] == 1.0  # welcome + invalid present


# -- Task 3 (delegates to the real validation gate) -------------------------
_GOOD = "\n".join([
    "import pytest",
    "from playwright.sync_api import Page, expect",
    "",
    "pytestmark = [pytest.mark.generated]",
    "",
    "",
    "# TC: TC-001 valid login",
    "# REQ: REQ-X",
    "def test_valid_login(page: Page, base_url: str) -> None:",
    "    page.goto(base_url)",
    '    expect(page.get_by_role("heading", name="Welcome")).to_be_visible()',
])

# Assembled so this test file itself does not carry a literal secret.
_BAD = "\n".join([
    "import os",
    "import time",
    "",
    "def test_bad(page):",
    "    " + "pass" + 'word = "SuperSecret123!"',
    "    time.sleep(3)",
    '    os.system("echo hi")',
])


def test_automation_gate_pass_and_fail():
    good = det.score_automation(
        {"files": [{"path": "automation/generated_tests/test_ok.py", "content": _GOOD}]},
        _item(), run_collection=False,
    )
    assert good["scores"]["gate_pass"] == 1.0
    assert good["detail"]["num_errors"] == 0

    bad = det.score_automation(
        {"files": [{"path": "automation/generated_tests/test_bad.py", "content": _BAD}]},
        _item(), run_collection=False,
    )
    assert bad["scores"]["gate_pass"] == 0.0
    assert bad["detail"]["num_errors"] >= 3  # forbidden import/os + sleep + secret


def test_automation_no_files():
    r = det.score_automation({"files": []}, _item(), run_collection=False)
    assert r["scores"]["gate_pass"] == 0.0
