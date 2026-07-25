"""Unit tests for the research-grade per-run metrics (no Ollama needed)."""

from __future__ import annotations

from evaluation.benchmark.schema import BenchmarkItem
from evaluation.metrics import (
    code_quality,
    completeness,
    coverage,
    execution,
    explainability,
    hallucination,
)


def _item(**ov) -> BenchmarkItem:
    base = {
        "id": "t", "title": "t", "project_name": "p", "base_url": "http://localhost:8001",
        "requirement": {"id": "REQ-X", "title": "x", "text": "login with username and password",
                        "acceptance_criteria": ["Valid credentials show a welcome message"]},
        "coverage_checklist": [
            {"id": "valid", "description": "valid login welcome", "keywords": ["welcome"]},
            {"id": "invalid", "description": "invalid credentials rejected", "keywords": ["invalid"]},
        ],
        "expected_test_types": ["UI"], "expected_categories": ["positive"],
    }
    base.update(ov)
    return BenchmarkItem.model_validate(base)


# -- Completeness -----------------------------------------------------------
def test_completeness_plan_full_vs_partial():
    full = {s: ["x"] for s in completeness._PLAN_SECTIONS}
    assert completeness.score_completeness("test_plan", full, _item())["score"] == 1.0
    partial = {s: [] for s in completeness._PLAN_SECTIONS}
    partial["objectives"] = ["x"]
    r = completeness.score_completeness("test_plan", partial, _item())
    assert r["score"] == round(1 / 10, 4)
    assert "objectives" in r["detail"]["present"]


def test_completeness_automation_elements():
    good = {"files": [{"path": "automation/generated_tests/test_x.py", "content":
        "from automation.pages.sample_login_page import SampleLoginPage\n"
        "# TC: TC-001 x\n# REQ: REQ-X\n"
        "def test_x(page, base_url):\n    expect(page).to_be_visible()\n"}]}
    r = completeness.score_completeness("automation", good, _item())
    assert r["score"] == 1.0  # imports, POM, assertion, fixture, traceability
    bare = {"files": [{"path": "automation/generated_tests/test_y.py", "content": "x = 1\n"}]}
    assert completeness.score_completeness("automation", bare, _item())["score"] < 0.5


# -- Coverage ---------------------------------------------------------------
def test_coverage_reports_uncovered():
    text = "The test verifies a welcome message on valid login."  # 'invalid' keyword missing
    r = coverage.score_coverage("test_plan", text, _item())
    ids = [u["id"] for u in r["detail"]["uncovered"]]
    assert "checklist:invalid" in ids
    assert 0.0 < r["score"] < 1.0


# -- Hallucination ----------------------------------------------------------
def test_hallucination_detects_invalid_matcher():
    code = {"files": [{"path": "automation/generated_tests/test_x.py", "content":
        "def test_x(page):\n    expect(page).to_be_awesome()\n"}]}
    r = hallucination.score_hallucination("automation", code)
    assert r["metrics"]["hallucination_count"] >= 1
    assert r["score"] < 1.0


def test_hallucination_clean_code_is_clean():
    code = {"files": [{"path": "automation/generated_tests/test_x.py", "content":
        "def test_x(page):\n    expect(page).to_be_visible()\n"}]}
    assert hallucination.score_hallucination("automation", code)["score"] == 1.0


def test_hallucination_judge_severity_weighting():
    r = hallucination.score_hallucination(
        "test_plan", {}, judge_hallucinations=[{"text": "invented API", "severity": "critical"}],
    )
    assert r["metrics"]["hallucination_severity_score"] == 1.0
    assert r["detail"]["counts_by_severity"]["critical"] == 1


# -- Code quality -----------------------------------------------------------
def test_code_quality_penalises_raw_selectors():
    pom = {"files": [{"path": "automation/generated_tests/test_a.py", "content":
        "from automation.pages.sample_login_page import SampleLoginPage\n"
        "# TC: TC-1 x\n# REQ: REQ-X\n"
        "def test_a(page):\n    expect(page).to_be_visible()\n"}]}
    raw = {"files": [{"path": "automation/generated_tests/test_b.py", "content":
        "def test_b(page):\n    page.locator('div.foo').click()\n"}]}
    assert code_quality.score_code_quality(pom)["score"] > code_quality.score_code_quality(raw)["score"]


# -- Explainability ---------------------------------------------------------
def test_explainability_rewards_justified_types():
    justified = {"test_types": ["UI: because the app is web-based"], "risks": ["auth risk - mitigated by tests"]}
    bare = {"test_types": ["UI"], "risks": ["auth risk"]}
    assert explainability.score_explainability("test_plan", justified, "")["score"] > \
           explainability.score_explainability("test_plan", bare, "")["score"]


# -- Executability ----------------------------------------------------------
def test_executability_static_and_executed():
    passing_gate = {"passed": True, "issues_by_check": {}, "issues": []}
    static = execution.score_executability(passing_gate)
    assert static["detail"]["execution_status"] == "static-only"
    assert static["score"] == 1.0

    executed = execution.score_executability(passing_gate, {"value": 1.0, "detail": {"tests": 2, "passed": 2}})
    assert executed["detail"]["execution_status"] == "executed"
    assert executed["metrics"]["execution_pass_rate"] == 1.0

    failing_gate = {"passed": False, "issues_by_check": {"syntax": {"error": 1}},
                    "issues": [{"check": "syntax", "severity": "error", "message": "bad", "location": "f"}]}
    fail = execution.score_executability(failing_gate)
    assert fail["metrics"]["build_status"] == 0.0
    assert fail["detail"]["failure_reason"] is not None
