"""Execution endpoints: run, inspect and cancel local test runs (SRS §14.2).

POST /executions enforces the human-approval gate before any generated code
runs (FR-HITL-001): every generated artifact referenced by the requested test
paths must have ``approval_status='approved'`` or the request is refused with
HTTP 403. Runs are driven synchronously by
:func:`app.services.execution.start_local_execution` (FR-EXE-001..005) and
results are returned per test (FR-RES-001). Every mutation records an audit
event (FR-AUD-001).
"""

from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.models.entities import ExecutionRun, GeneratedArtifact, Project, TestResult
from app.models.schemas import ExecutionRequest, ExecutionRunOut, TestResultOut
from app.services.audit import record_event
from app.services.execution import cancel_execution, start_local_execution

router = APIRouter(prefix="/executions", tags=["executions"])


def _safe_paths(paths: list[str]) -> list[str]:
    """Reject absolute paths and traversal in requested test paths (§13.1)."""
    cleaned: list[str] = []
    for raw in paths:
        path = raw.strip().replace("\\", "/").rstrip("/")
        if not path:
            continue
        parts = PurePosixPath(path).parts
        if PurePosixPath(path).is_absolute() or ".." in parts:
            raise HTTPException(
                status_code=400,
                detail=f"test path {raw!r} is absolute or escapes the workspace; "
                "repo-relative paths only.",
            )
        cleaned.append(path)
    return cleaned


def _referenced_artifacts(
    db: Session, project_id: str, test_paths: list[str]
) -> list[GeneratedArtifact]:
    """Generated artifacts covered by the requested paths (file or directory)."""
    artifacts = db.scalars(
        select(GeneratedArtifact).where(GeneratedArtifact.project_id == project_id)
    ).all()
    referenced: list[GeneratedArtifact] = []
    for artifact in artifacts:
        # Strip a pytest node-id suffix so 'file.py::test_x' matches too.
        for requested in test_paths:
            base = requested.split("::", 1)[0]
            if artifact.path == base or artifact.path.startswith(base + "/"):
                referenced.append(artifact)
                break
    return referenced


@router.post("", status_code=201)
def start_execution(body: ExecutionRequest, db: Session = Depends(get_db)) -> dict:
    """Execute approved generated tests locally (FR-EXE-001..004, FR-HITL-001)."""
    project = db.get(Project, body.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {body.project_id!r} not found.")

    settings = get_settings()
    test_paths = _safe_paths(body.test_paths) or [settings.generated_tests_dir]

    # FR-HITL-001 / SEC-006: no generated code runs without recorded approval.
    referenced = _referenced_artifacts(db, body.project_id, test_paths)
    unapproved = [a.path for a in referenced if a.approval_status != "approved"]
    if unapproved:
        raise HTTPException(
            status_code=403,
            detail="Execution refused (FR-HITL-001): these generated artifacts "
            f"are not approved: {sorted(set(unapproved))}. Approve them via "
            "POST /artifacts/{id}/approve first.",
        )

    request = body.model_copy(update={"test_paths": test_paths})
    try:
        run = start_local_execution(db, body.project_id, request)
    except ValueError as exc:  # unsupported browser
        raise HTTPException(status_code=400, detail=str(exc)) from None

    record_event(
        db,
        actor="local-user",
        action="execution.start",
        resource=f"execution:{run.id}",
        result="success" if run.status in {"completed", "cancelled"} else run.status,
        correlation_id=new_correlation_id(),
        project_id=body.project_id,
        test_paths=test_paths,
        browser=body.browser,
        status=run.status,
        metrics=run.metrics,
    )
    return _run_with_results(db, run)


@router.get("/{execution_id}")
def get_execution(execution_id: str, db: Session = Depends(get_db)) -> dict:
    """Fetch one execution run with its per-test results (FR-RES-001)."""
    run = db.get(ExecutionRun, execution_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")
    return _run_with_results(db, run)


@router.post("/{execution_id}/cancel")
def cancel(execution_id: str, db: Session = Depends(get_db)) -> dict:
    """Cancel a running execution (FR-EXE-005)."""
    run = db.get(ExecutionRun, execution_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")
    signalled = cancel_execution(db, execution_id)
    db.refresh(run)
    record_event(
        db,
        actor="local-user",
        action="execution.cancel",
        resource=f"execution:{execution_id}",
        result="success" if signalled else "failure",
        correlation_id=new_correlation_id(),
        signalled=signalled,
        status=run.status,
    )
    return {"cancelled": signalled, "run": ExecutionRunOut.model_validate(run).model_dump()}


def _run_with_results(db: Session, run: ExecutionRun) -> dict:
    results = db.scalars(
        select(TestResult)
        .where(TestResult.execution_run_id == run.id)
        .order_by(TestResult.node_id)
    ).all()
    return {
        "run": ExecutionRunOut.model_validate(run).model_dump(),
        "results": [TestResultOut.model_validate(r).model_dump() for r in results],
    }
