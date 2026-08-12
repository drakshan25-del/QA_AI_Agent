"""Unit tests for regression run comparison (service + engine endpoint).

Pure-function coverage for app.services.regression.compare_runs plus the
stateless /internal/v1/regression-compare endpoint (auth + validation).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services.regression import compare_runs
from engine.service.main import app

pytestmark = pytest.mark.unit

TOKEN = "dev-engine-token"  # matches the default ENGINE_TOKEN in tests


def _r(node_id: str, outcome: str) -> dict:
    return {"node_id": node_id, "outcome": outcome}


class TestCompareRuns:
    def test_pass_to_fail_is_regression(self):
        report = compare_runs([_r("t::a", "passed")], [_r("t::a", "failed")])
        assert report["regressions"] == ["t::a"]
        assert report["summary"]["has_regressions"] is True

    def test_error_counts_as_failing(self):
        report = compare_runs([_r("t::a", "passed")], [_r("t::a", "error")])
        assert report["regressions"] == ["t::a"]

    def test_fail_to_pass_is_fix(self):
        report = compare_runs([_r("t::a", "failed")], [_r("t::a", "passed")])
        assert report["fixes"] == ["t::a"]
        assert report["summary"]["has_regressions"] is False

    def test_fail_to_fail_is_still_failing_not_regression(self):
        report = compare_runs([_r("t::a", "failed")], [_r("t::a", "failed")])
        assert report["still_failing"] == ["t::a"]
        assert report["regressions"] == []
        assert report["summary"]["has_regressions"] is False

    def test_stable_passes_counted(self):
        report = compare_runs(
            [_r("t::a", "passed"), _r("t::b", "passed")],
            [_r("t::a", "passed"), _r("t::b", "passed")],
        )
        assert report["stable_passes"] == 2

    def test_new_and_missing_tests_reported(self):
        report = compare_runs([_r("t::old", "passed")], [_r("t::new", "failed")])
        assert report["missing_tests"] == ["t::old"]
        assert report["new_tests"] == [{"node_id": "t::new", "status": "fail"}]
        # A brand-new failing test is not a regression — nothing regressed.
        assert report["summary"]["has_regressions"] is False

    def test_skip_in_either_run_gives_no_verdict(self):
        report = compare_runs(
            [_r("t::a", "passed"), _r("t::b", "skipped")],
            [_r("t::a", "skipped"), _r("t::b", "failed")],
        )
        assert sorted(report["skipped"]) == ["t::a", "t::b"]
        assert report["regressions"] == []

    def test_duplicate_node_ids_keep_last_occurrence(self):
        # pytest-rerunfailures lists the final attempt last.
        report = compare_runs(
            [_r("t::a", "passed")],
            [_r("t::a", "failed"), _r("t::a", "passed")],
        )
        assert report["regressions"] == []
        assert report["stable_passes"] == 1

    def test_empty_runs(self):
        report = compare_runs([], [])
        assert report["summary"] == {
            "baseline_total": 0,
            "current_total": 0,
            "regressed": 0,
            "fixed": 0,
            "still_failing": 0,
            "new": 0,
            "missing": 0,
            "has_regressions": False,
        }


class TestRegressionCompareEndpoint:
    @pytest.fixture()
    def client(self) -> TestClient:
        return TestClient(app)

    def test_requires_token(self, client):
        response = client.post(
            "/internal/v1/regression-compare", json={"baseline": [], "current": []}
        )
        assert response.status_code == 401

    def test_compares_runs(self, client):
        response = client.post(
            "/internal/v1/regression-compare",
            headers={"X-Engine-Token": TOKEN},
            json={
                "baseline": [_r("t::a", "passed")],
                "current": [_r("t::a", "failed")],
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["regressions"] == ["t::a"]
        assert body["summary"]["has_regressions"] is True

    def test_rejects_non_list_payload(self, client):
        response = client.post(
            "/internal/v1/regression-compare",
            headers={"X-Engine-Token": TOKEN},
            json={"baseline": "nope", "current": []},
        )
        assert response.status_code == 422
