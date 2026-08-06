"""Regression tests: engine /report must render the V2 backend payload.

The V2 backend posts {run_summary, tests, metrics[, project]} while the V1
renderers expect the full section dict; the adapter bridges the two
(previously the mismatch caused HTTP 500 on POST /internal/v1/report).
"""

from app.services.report_service import render_report_html, render_report_md
from engine.service.report_adapter import to_report_data

V2_PAYLOAD = {
    "run_summary": {
        "run_id": "run-1",
        "project_id": "proj-1",
        "status": "completed",
        "environment": "local",
        "browser": "chromium",
        "started_at": "2026-07-17T06:14:22.734Z",
        "finished_at": "2026-07-17T06:14:25.338Z",
        "metrics": {"passed": 1, "failed": 1, "skipped": 0, "errors": 0,
                    "duration_seconds": 2.0, "total": 2},
    },
    "project": {"name": "Demo", "base_url": "http://localhost:3000",
                "environment": "local"},
    "tests": [
        {"node_id": "t.py::ok", "outcome": "passed", "duration_seconds": 1.0,
         "error_message": None},
        {"node_id": "t.py::bad", "outcome": "failed", "duration_seconds": 1.0,
         "error_message": "AssertionError: boom"},
    ],
    "metrics": {"passed": 1, "failed": 1, "skipped": 0, "errors": 0,
                "duration_seconds": 2.0, "total": 2},
}


def test_adapter_fills_all_renderer_keys():
    data = to_report_data(V2_PAYLOAD)
    for key in ("title", "generated_at", "project", "run", "scope", "metrics",
                "results", "failures", "defects", "coverage", "evidence_links",
                "recommendations", "reproducibility"):
        assert key in data, key
    assert data["project"]["name"] == "Demo"
    assert data["metrics"]["total"] == 2
    assert data["metrics"]["pass_rate_percent"] == 50.0
    assert len(data["failures"]) == 1
    assert data["failures"][0]["classification"] == "unclassified"


def test_v2_payload_renders_md_and_html():
    data = to_report_data(V2_PAYLOAD)
    data.setdefault("ai_narrative", {"label": "auto", "text": "n/a"})
    md = render_report_md(data)
    html = render_report_html(data)
    assert "Run Summary" in md and "t.py::bad" in md
    assert "<h1>" in html and "AssertionError" in html


def test_empty_payload_renders():
    data = to_report_data({"run_summary": {}, "tests": [], "metrics": {}})
    data.setdefault("ai_narrative", {"label": "auto", "text": "n/a"})
    assert render_report_md(data)
    assert render_report_html(data)
