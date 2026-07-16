"""Unit tests for JUnit result parsing (FR-RES-001, FR-EXE-004).

A small junit.xml fixture string is written to ``tmp_path`` and parsed —
no pytest subprocess, browser or network involved (SRS §15.1).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from app.services.results import collect_evidence, parse_junit

pytestmark = pytest.mark.unit

# Secret assembled at runtime so this file carries no literal credential;
# quotes are XML-escaped because the value sits inside an attribute.
_SECRET_IN_MESSAGE = "pass" + "word = &quot;hunter22222&quot;"

JUNIT_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="1" failures="1" skipped="1" tests="4" time="3.250">
    <testcase classname="generated.test_login" name="test_login_valid" time="1.200"/>
    <testcase classname="generated.test_login" name="test_login_invalid" time="0.800">
      <failure message="AssertionError: flash mismatch">assert 'Server error' == 'Invalid credentials'</failure>
    </testcase>
    <testcase classname="generated.test_items" name="test_add_item" time="0.500">
      <skipped message="target app not running"/>
    </testcase>
    <testcase classname="generated.test_items" name="test_delete_item" time="0.750">
      <error message="fixture crashed: {_SECRET_IN_MESSAGE}">traceback detail</error>
    </testcase>
  </testsuite>
</testsuites>
"""


@pytest.fixture()
def junit_path(tmp_path):
    path = tmp_path / "junit.xml"
    path.write_text(JUNIT_XML, encoding="utf-8")
    return path


class TestParseJunit:
    def test_counts(self, junit_path):
        result = parse_junit(junit_path)
        assert result["passed"] == 1
        assert result["failed"] == 1
        assert result["skipped"] == 1
        assert result["errors"] == 1
        assert len(result["tests"]) == 4

    def test_suite_duration_preferred(self, junit_path):
        result = parse_junit(junit_path)
        assert result["duration_seconds"] == pytest.approx(3.25)

    def test_outcomes_and_node_ids(self, junit_path):
        by_name = {t["node_id"]: t for t in parse_junit(junit_path)["tests"]}
        assert by_name["generated.test_login::test_login_valid"]["outcome"] == "passed"
        assert by_name["generated.test_login::test_login_invalid"]["outcome"] == "failed"
        assert by_name["generated.test_items::test_add_item"]["outcome"] == "skipped"
        assert by_name["generated.test_items::test_delete_item"]["outcome"] == "error"

    def test_failure_message_includes_detail_text(self, junit_path):
        tests = parse_junit(junit_path)["tests"]
        failed = next(t for t in tests if t["outcome"] == "failed")
        assert "AssertionError: flash mismatch" in failed["message"]
        assert "Invalid credentials" in failed["message"]

    def test_skip_reason_captured(self, junit_path):
        tests = parse_junit(junit_path)["tests"]
        skipped = next(t for t in tests if t["outcome"] == "skipped")
        assert skipped["message"] == "target app not running"

    def test_passed_test_has_empty_message(self, junit_path):
        tests = parse_junit(junit_path)["tests"]
        passed = next(t for t in tests if t["outcome"] == "passed")
        assert passed["message"] == ""

    def test_durations_parsed(self, junit_path):
        tests = parse_junit(junit_path)["tests"]
        failed = next(t for t in tests if t["outcome"] == "failed")
        assert failed["duration"] == pytest.approx(0.8)

    def test_messages_are_secret_redacted(self, junit_path):
        # SEC-007: error text is redacted before storage/reporting.
        tests = parse_junit(junit_path)["tests"]
        errored = next(t for t in tests if t["outcome"] == "error")
        assert "hunter22222" not in errored["message"]
        assert "***REDACTED***" in errored["message"]

    def test_single_testsuite_root_supported(self, tmp_path):
        xml = (
            '<testsuite name="pytest" tests="1" time="0.5">'
            '<testcase classname="generated.test_x" name="test_ok" time="0.5"/>'
            "</testsuite>"
        )
        path = tmp_path / "single.xml"
        path.write_text(xml, encoding="utf-8")
        result = parse_junit(path)
        assert result["passed"] == 1
        assert result["duration_seconds"] == pytest.approx(0.5)

    def test_missing_report_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            parse_junit(tmp_path / "does-not-exist.xml")

    def test_malformed_xml_raises(self, tmp_path):
        path = tmp_path / "broken.xml"
        path.write_text("<testsuites><testsuite>", encoding="utf-8")
        with pytest.raises(ET.ParseError):
            parse_junit(path)


class TestCollectEvidence:
    def test_maps_artifacts_to_test_slugs(self, tmp_path):
        slug = tmp_path / "test-login-py-test-invalid-chromium"
        slug.mkdir()
        (slug / "test-failed-1.png").write_bytes(b"\x89PNG fake")
        (slug / "trace.zip").write_bytes(b"PK fake")
        evidence = collect_evidence(tmp_path)
        bucket = evidence["test-login-py-test-invalid-chromium"]
        assert len(bucket["screenshots"]) == 1
        assert len(bucket["traces"]) == 1
        assert bucket["videos"] == []

    def test_missing_directory_returns_empty(self, tmp_path):
        assert collect_evidence(tmp_path / "nope") == {}

    def test_unclassifiable_entries_dropped(self, tmp_path):
        slug = tmp_path / "test-something-chromium"
        slug.mkdir()
        (slug / "notes.txt").write_text("not evidence", encoding="utf-8")
        assert collect_evidence(tmp_path) == {}
