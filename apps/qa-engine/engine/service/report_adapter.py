"""Adapt the V2 backend report payload to the V1 renderer data shape.

The backend posts ``{run_summary, tests, metrics, project?}`` (V2_CONTRACT §4)
but the pure renderers in :mod:`app.services.report_service` consume the rich
V1 section dict (title/project/run/metrics/results/failures/coverage/...).
This module fills every key the renderers touch with measured values where
available and explicit placeholders where not (FR-REP-002: measured vs AI).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from agents import report_agent, result_analysis_agent
from app.core.llm import generation_metadata
from app.services.report_service import MEASURED_LABEL, _recommendations

_MAX_ERROR_CHARS = 1500


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return default


def to_report_data(raw: dict) -> dict:
    """Build the renderer data dict from the V2 report payload (pure)."""
    summary = raw.get("run_summary") or {}
    project = raw.get("project") or {}
    tests = raw.get("tests") or raw.get("results") or []

    result_rows = []
    failures = []
    classifications: list[str] = []
    for t in sorted(tests, key=lambda x: str(x.get("node_id", ""))):
        node_id = str(t.get("node_id", ""))
        outcome = str(t.get("outcome", "unknown"))
        error_message = str(t.get("error_message") or "")
        result_rows.append({
            "node_id": node_id,
            "outcome": outcome,
            "duration_seconds": _num(t.get("duration_seconds")),
            "error_message": error_message[:300],
            "evidence": t.get("evidence") or [],
        })
        if outcome in ("failed", "error"):
            classification = str(t.get("classification") or "unclassified")
            classifications.append(classification)
            failures.append({
                "node_id": node_id,
                "outcome": outcome,
                "classification": classification,
                "confidence": t.get("confidence"),
                "severity": str(t.get("severity") or ""),
                "rationale": str(t.get("rationale") or ""),
                "error_message": error_message[:_MAX_ERROR_CHARS],
                "evidence": t.get("evidence") or [],
            })

    outcomes = [r["outcome"] for r in result_rows]
    metrics_in = raw.get("metrics") or summary.get("metrics") or {}
    total = int(metrics_in.get("total", len(result_rows)))
    passed = int(metrics_in.get("passed", outcomes.count("passed")))
    failed = int(metrics_in.get("failed", outcomes.count("failed")))
    skipped = int(metrics_in.get("skipped", outcomes.count("skipped")))
    errors = int(metrics_in.get("errors", outcomes.count("error")))
    executed = max(total - skipped, 0)
    pass_rate = round(100.0 * passed / executed, 1) if executed else 0.0
    duration = _num(
        metrics_in.get("duration_seconds",
                       sum(r["duration_seconds"] for r in result_rows)))

    run_id = str(summary.get("run_id", ""))
    llm_meta = generation_metadata()

    data = dict(raw)  # keep original keys (run_summary, tests, ...) intact
    data.update({
        "title": f"Test Execution Report - run {run_id or '(unknown)'}",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "project": {
            "name": str(project.get("name")
                        or summary.get("project_id") or "(unknown project)"),
            "environment": str(project.get("environment")
                               or summary.get("environment") or "local"),
            "base_url": str(project.get("base_url") or ""),
        },
        "run": {
            "id": run_id,
            "status": str(summary.get("status", "")),
            "mode": str(summary.get("mode", "local")),
            "environment": str(summary.get("environment", "local")),
            "browser": str(summary.get("browser", "")),
            "source_commit": str(summary.get("source_commit") or ""),
            "ci_run_id": str(summary.get("ci_run_id") or ""),
            "ci_url": str(summary.get("ci_url") or ""),
            "started_at": str(summary.get("started_at") or ""),
            "finished_at": str(summary.get("finished_at") or ""),
        },
        "scope": sorted({r["node_id"].split("::", 1)[0]
                         for r in result_rows if r["node_id"]}),
        "metrics": {
            "label": MEASURED_LABEL,
            "total": total,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
            "pass_rate_percent": pass_rate,
            "duration_seconds": duration,
        },
        "results": result_rows,
        "failures": failures,
        "defects": raw.get("defects") or [],
        "coverage": raw.get("coverage") or {
            "label": MEASURED_LABEL,
            "test_cases_total": total,
            "test_cases_executed": executed,
            "coverage_percent": round(100.0 * executed / total, 1) if total else 0.0,
            "requirements_covered": [],
        },
        "evidence_links": raw.get("evidence_links") or [],
        "recommendations": _recommendations(failed + errors, classifications),
        "reproducibility": {
            "provider": llm_meta["provider"],
            "model": llm_meta["model"],
            "temperature": llm_meta["temperature"],
            "prompt_versions": {
                "result_analysis": result_analysis_agent.PROMPT_VERSION,
                "report": report_agent.PROMPT_VERSION,
            },
            "source_commit": str(summary.get("source_commit") or "(not recorded)"),
            "ci_run_id": str(summary.get("ci_run_id") or "(local run)"),
            "ci_url": str(summary.get("ci_url") or ""),
        },
    })
    return data
