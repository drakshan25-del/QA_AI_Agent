"""Unit tests for the CI regression gate script (scripts/regression_gate.py).

Small JUnit XML fixtures are written to ``tmp_path`` and ``main(argv)`` is
invoked in-process — no subprocess, network or LLM involved (SRS §15.1).
Covers the exit-code contract the CI job keys on: 1 iff a previously-passing
test fails now, 0 for a clean run and for both missing-report skip paths.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# scripts/ is not a package; import the gate module straight off its directory
# (the script itself does the mirror-image sys.path dance for CLI use).
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import regression_gate  # noqa: E402

pytestmark = pytest.mark.unit


def _junit_xml(cases: dict[str, str]) -> str:
    """Render a minimal junit report from ``{test name: outcome}``."""
    body = ""
    for name, outcome in cases.items():
        if outcome == "passed":
            body += f'<testcase classname="generated.test_core" name="{name}" time="0.1"/>'
        else:
            tag = {"failed": "failure", "error": "error", "skipped": "skipped"}[outcome]
            body += (
                f'<testcase classname="generated.test_core" name="{name}" time="0.1">'
                f'<{tag} message="boom"/></testcase>'
            )
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        f'<testsuites><testsuite name="pytest" tests="{len(cases)}" time="1.0">'
        f"{body}</testsuite></testsuites>"
    )


def _write_reports(tmp_path, baseline: dict[str, str], current: dict[str, str]) -> tuple[Path, Path]:
    baseline_path = tmp_path / "baseline.xml"
    current_path = tmp_path / "current.xml"
    baseline_path.write_text(_junit_xml(baseline), encoding="utf-8")
    current_path.write_text(_junit_xml(current), encoding="utf-8")
    return baseline_path, current_path


class TestRegressionGate:
    def test_regression_detected_exits_1_and_names_the_test(self, tmp_path, capsys):
        baseline, current = _write_reports(
            tmp_path,
            {"test_login": "passed", "test_items": "passed"},
            {"test_login": "failed", "test_items": "passed"},
        )
        assert regression_gate.main([str(baseline), str(current)]) == 1
        out = capsys.readouterr().out
        assert "regressed=1" in out
        assert "generated.test_core::test_login" in out

    def test_error_outcome_counts_as_regression(self, tmp_path):
        baseline, current = _write_reports(
            tmp_path, {"test_login": "passed"}, {"test_login": "error"}
        )
        assert regression_gate.main([str(baseline), str(current)]) == 1

    def test_no_regressions_exits_0(self, tmp_path, capsys):
        baseline, current = _write_reports(
            tmp_path,
            {"test_login": "passed", "test_items": "failed"},
            {"test_login": "passed", "test_items": "failed"},
        )
        assert regression_gate.main([str(baseline), str(current)]) == 0
        out = capsys.readouterr().out
        assert "No regressions detected" in out
        assert "still_failing=1" in out

    def test_fix_is_not_a_regression(self, tmp_path):
        baseline, current = _write_reports(
            tmp_path, {"test_login": "failed"}, {"test_login": "passed"}
        )
        assert regression_gate.main([str(baseline), str(current)]) == 0

    def test_missing_baseline_skips_gate_with_exit_0(self, tmp_path, capsys):
        _, current = _write_reports(tmp_path, {}, {"test_login": "failed"})
        missing = tmp_path / "no-baseline.xml"
        assert regression_gate.main([str(missing), str(current)]) == 0
        assert "no baseline available; skipping regression gate" in capsys.readouterr().out

    def test_missing_current_skips_gate_with_exit_0(self, tmp_path, capsys):
        baseline, _ = _write_reports(tmp_path, {"test_login": "passed"}, {})
        missing = tmp_path / "no-current.xml"
        assert regression_gate.main([str(baseline), str(missing)]) == 0
        assert "Skipping regression gate" in capsys.readouterr().out

    def test_json_flag_prints_parseable_compare_dict(self, tmp_path, capsys):
        baseline, current = _write_reports(
            tmp_path,
            {"test_login": "passed", "test_new": "passed"},
            {"test_login": "failed", "test_extra": "passed"},
        )
        assert regression_gate.main(["--json", str(baseline), str(current)]) == 1
        comparison = json.loads(capsys.readouterr().out)
        assert comparison["regressions"] == ["generated.test_core::test_login"]
        assert comparison["summary"]["has_regressions"] is True
        assert comparison["missing_tests"] == ["generated.test_core::test_new"]
        assert [t["node_id"] for t in comparison["new_tests"]] == [
            "generated.test_core::test_extra"
        ]
