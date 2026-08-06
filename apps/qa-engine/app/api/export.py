"""Machine-readable project export and research metrics (SRS §18 item 13 / AC13).

``GET /projects/{id}/export`` serialises the full project graph — project,
requirements, analyses, test plans, test cases, generated artifacts (metadata
only: hashes, paths and validation status, never file content), generation
runs, execution runs, test results, findings, approvals and audit events —
as one JSON document for external analysis (§10.2, NFR-EXP-001).

``GET /projects/{id}/metrics`` aggregates the SRS §15.2 research metrics from
the database: requirement coverage, case category distribution, automation
execution success, findings by classification, human overrides of AI
classifications, mean generation duration per kind and per-run pass rates.

No key whose name contains ``password``, ``token`` or ``secret`` is ever
emitted (SEC-002/SEC-007): the export is scrubbed recursively before return.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.db import get_db
from app.models.entities import (
    Analysis,
    Approval,
    AuditEvent,
    ExecutionRun,
    Finding,
    GeneratedArtifact,
    GenerationRun,
    Project,
    Requirement,
    TestCase,
    TestPlan,
    TestResult,
)

logger = get_logger(__name__)

router = APIRouter(tags=["export"])

#: Keys containing any of these substrings are dropped from the export
#: (SEC-002/SEC-007 — no secret material in machine-readable output).
_FORBIDDEN_KEY_PARTS = ("password", "passwd", "token", "secret", "credential")


def _row_to_dict(obj: Any) -> dict:
    """Serialise an ORM row's column attributes to a plain dict."""
    return {attr.key: getattr(obj, attr.key) for attr in sa_inspect(obj).mapper.column_attrs}


def _scrub(value: Any) -> Any:
    """Recursively drop any key whose name looks secret-bearing (SEC-002)."""
    if isinstance(value, dict):
        return {
            key: _scrub(item)
            for key, item in value.items()
            if not any(part in str(key).lower() for part in _FORBIDDEN_KEY_PARTS)
        }
    if isinstance(value, (list, tuple)):
        return [_scrub(item) for item in value]
    return value


def _artifact_export(artifact: GeneratedArtifact) -> dict:
    """Artifact metadata WITHOUT content: hash, path and validation status."""
    row = _row_to_dict(artifact)
    row.pop("content", None)
    row["validation_passed"] = bool((artifact.validation_report or {}).get("passed", False))
    return row


def _project_graph(db: Session, project: Project) -> dict[str, list]:
    """Load every row belonging to a project, keyed by entity kind."""
    requirements = list(
        db.scalars(
            select(Requirement)
            .where(Requirement.project_id == project.id)
            .order_by(Requirement.created_at)
        ).all()
    )
    requirement_ids = [r.id for r in requirements]
    analyses = (
        list(
            db.scalars(
                select(Analysis)
                .where(Analysis.requirement_id.in_(requirement_ids))
                .order_by(Analysis.created_at)
            ).all()
        )
        if requirement_ids
        else []
    )
    test_plans = list(
        db.scalars(
            select(TestPlan)
            .where(TestPlan.project_id == project.id)
            .order_by(TestPlan.created_at)
        ).all()
    )
    test_cases = list(
        db.scalars(
            select(TestCase)
            .where(TestCase.project_id == project.id)
            .order_by(TestCase.created_at)
        ).all()
    )
    artifacts = list(
        db.scalars(
            select(GeneratedArtifact)
            .where(GeneratedArtifact.project_id == project.id)
            .order_by(GeneratedArtifact.created_at)
        ).all()
    )
    generation_runs = list(
        db.scalars(
            select(GenerationRun)
            .where(GenerationRun.project_id == project.id)
            .order_by(GenerationRun.created_at)
        ).all()
    )
    execution_runs = list(
        db.scalars(
            select(ExecutionRun)
            .where(ExecutionRun.project_id == project.id)
            .order_by(ExecutionRun.created_at)
        ).all()
    )
    execution_run_ids = [r.id for r in execution_runs]
    results = (
        list(
            db.scalars(
                select(TestResult).where(
                    TestResult.execution_run_id.in_(execution_run_ids)
                )
            ).all()
        )
        if execution_run_ids
        else []
    )
    result_ids = [r.id for r in results]
    findings = (
        list(
            db.scalars(
                select(Finding)
                .where(Finding.result_id.in_(result_ids))
                .order_by(Finding.created_at)
            ).all()
        )
        if result_ids
        else []
    )
    return {
        "requirements": requirements,
        "analyses": analyses,
        "test_plans": test_plans,
        "test_cases": test_cases,
        "artifacts": artifacts,
        "generation_runs": generation_runs,
        "execution_runs": execution_runs,
        "results": results,
        "findings": findings,
    }


@router.get("/projects/{project_id}/export")
def export_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    """Export the full project graph as one JSON document (AC13, §10.2).

    Generated artifacts are exported without their content — only path,
    sha256 content hash, approval status and validation report/status — so
    the export stays lightweight and reviewable. Every key containing
    ``password``/``token``/``secret`` is scrubbed recursively (SEC-002).
    """
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found.")

    graph = _project_graph(db, project)

    # Approvals reference artefact ids without a project column; include every
    # approval pointing at an entity of this project.
    project_entity_ids: set[str] = {project.id}
    for rows in graph.values():
        project_entity_ids.update(row.id for row in rows)
    approvals = [
        a
        for a in db.scalars(select(Approval).order_by(Approval.created_at)).all()
        if a.artefact_id in project_entity_ids
    ]
    # Audit events reference resources as '<kind>:<id>'; include events whose
    # resource id belongs to this project (or that carry its project_id).
    audit_events = [
        e
        for e in db.scalars(select(AuditEvent).order_by(AuditEvent.created_at)).all()
        if e.resource.rpartition(":")[2] in project_entity_ids
        or (e.event_metadata or {}).get("project_id") == project.id
    ]

    export = {
        "schema": "qa-agents-project-export/v1",
        "exported_at": datetime.now(timezone.utc),
        "project": _row_to_dict(project),
        "requirements": [_row_to_dict(r) for r in graph["requirements"]],
        "analyses": [_row_to_dict(a) for a in graph["analyses"]],
        "test_plans": [_row_to_dict(p) for p in graph["test_plans"]],
        "test_cases": [_row_to_dict(c) for c in graph["test_cases"]],
        "generated_artifacts": [_artifact_export(a) for a in graph["artifacts"]],
        "generation_runs": [_row_to_dict(g) for g in graph["generation_runs"]],
        "execution_runs": [_row_to_dict(e) for e in graph["execution_runs"]],
        "test_results": [_row_to_dict(t) for t in graph["results"]],
        "findings": [_row_to_dict(f) for f in graph["findings"]],
        "approvals": [_row_to_dict(a) for a in approvals],
        "audit_events": [_row_to_dict(e) for e in audit_events],
    }
    logger.info(
        "exported project %s (%d requirements, %d cases, %d runs)",
        project.id,
        len(export["requirements"]),
        len(export["test_cases"]),
        len(export["execution_runs"]),
        extra={"project_id": project.id},
    )
    return _scrub(export)


@router.get("/projects/{project_id}/metrics")
def project_metrics(project_id: str, db: Session = Depends(get_db)) -> dict:
    """Aggregate the SRS §15.2 research metrics for one project (AC13).

    Returns:
        ``requirements_coverage_pct`` — share of requirements traced by at
        least one *approved* test case (FR-TC-006);
        ``cases_by_category`` — test case counts per category (FR-TC-003);
        ``automation_execution_success_pct`` — passed / executed results
        (skipped excluded) across all runs;
        ``findings_by_classification`` — finding counts per classification
        (FR-RES-002); ``overridden_classification_count`` — findings whose AI
        classification was overridden by a human (FR-RES-003);
        ``mean_generation_duration_seconds_by_kind`` — mean duration of
        successful generation runs per kind (NFR-EXP-001);
        ``per_run_pass_rates`` — pass rate per execution run (FR-EXE-004).
    """
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found.")

    graph = _project_graph(db, project)
    requirements = graph["requirements"]
    test_cases = graph["test_cases"]
    execution_runs = graph["execution_runs"]
    results = graph["results"]
    findings = graph["findings"]
    generation_runs = graph["generation_runs"]

    # Requirement coverage by approved cases (FR-TC-006, §15.2).
    covered_ids = {
        rid
        for case in test_cases
        if case.review_status == "approved"
        for rid in (case.requirement_ids or [])
    }
    covered = [r.id for r in requirements if r.id in covered_ids]
    coverage_pct = (
        round(100.0 * len(covered) / len(requirements), 1) if requirements else 0.0
    )

    cases_by_category = dict(Counter(case.category for case in test_cases))

    # Automation execution success across all imported/executed results.
    executed = [r for r in results if r.outcome != "skipped"]
    passed_total = sum(1 for r in executed if r.outcome == "passed")
    success_pct = (
        round(100.0 * passed_total / len(executed), 1) if executed else 0.0
    )

    findings_by_classification = dict(Counter(f.classification for f in findings))
    overridden = sum(
        1
        for f in findings
        if f.overridden_by
        or (f.ai_classification and f.classification != f.ai_classification)
    )

    durations_by_kind: dict[str, list[float]] = defaultdict(list)
    for run in generation_runs:
        if run.status == "success":
            durations_by_kind[run.kind].append(run.duration_seconds or 0.0)
    mean_duration_by_kind = {
        kind: round(sum(values) / len(values), 3)
        for kind, values in durations_by_kind.items()
        if values
    }

    results_by_run: dict[str, list[TestResult]] = defaultdict(list)
    for result in results:
        results_by_run[result.execution_run_id].append(result)
    per_run_pass_rates: list[dict] = []
    for run in execution_runs:
        run_results = results_by_run.get(run.id, [])
        counted = [r for r in run_results if r.outcome != "skipped"]
        run_passed = sum(1 for r in counted if r.outcome == "passed")
        per_run_pass_rates.append(
            {
                "execution_run_id": run.id,
                "mode": run.mode,
                "status": run.status,
                "ci_run_id": run.ci_run_id,
                "source_commit": run.source_commit,
                "total": len(run_results),
                "passed": run_passed,
                "pass_rate_pct": (
                    round(100.0 * run_passed / len(counted), 1) if counted else 0.0
                ),
            }
        )

    return {
        "project_id": project.id,
        "generated_at": datetime.now(timezone.utc),
        "requirements_total": len(requirements),
        "requirements_covered_by_approved_cases": len(covered),
        "requirements_coverage_pct": coverage_pct,
        "cases_total": len(test_cases),
        "cases_by_category": cases_by_category,
        "automation_execution_success_pct": success_pct,
        "findings_by_classification": findings_by_classification,
        "overridden_classification_count": overridden,
        "mean_generation_duration_seconds_by_kind": mean_duration_by_kind,
        "per_run_pass_rates": per_run_pass_rates,
    }
