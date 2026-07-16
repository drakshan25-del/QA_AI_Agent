"""Requirement ingestion endpoints (SRS §14.2, FR-IN-001..006, FR-AUD-003).

Manual requirement entry, document upload (txt/md/pdf/docx/json via
``app.services.ingestion``), listing, and the per-requirement generation
history (FR-AUD-003). Every mutation records an audit event (FR-AUD-001).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.models.entities import Project, Requirement
from app.models.schemas import RequirementCreate, RequirementOut
from app.services.audit import record_event, requirement_history
from app.services.ingestion import (
    DuplicateRequirementError,
    create_requirement_from_text,
    ingest_file,
)
from tools.file_ingestion import IngestionError

router = APIRouter(tags=["requirements"])


def _get_project_or_404(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found.")
    return project


@router.post(
    "/projects/{project_id}/requirements",
    response_model=RequirementOut,
    status_code=201,
)
def create_requirement(
    project_id: str, body: RequirementCreate, db: Session = Depends(get_db)
) -> Requirement:
    """Add one requirement manually (FR-IN-002, FR-IN-005/006)."""
    _get_project_or_404(db, project_id)
    try:
        requirement = create_requirement_from_text(
            db,
            project_id,
            title=body.title,
            text=body.text,
            acceptance_criteria=body.acceptance_criteria,
            source=body.source or "manual",
        )
    except DuplicateRequirementError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except IngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    record_event(
        db,
        actor="local-user",
        action="requirement.create",
        resource=f"requirement:{requirement.id}",
        correlation_id=new_correlation_id(),
        project_id=project_id,
        source=requirement.source,
        version=requirement.version,
    )
    return requirement


@router.post(
    "/projects/{project_id}/requirements/upload",
    response_model=list[RequirementOut],
    status_code=201,
)
async def upload_requirements(
    project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)
) -> list[Requirement]:
    """Upload a requirements document and ingest it (FR-IN-001..006)."""
    _get_project_or_404(db, project_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file has no filename.")
    data = await file.read()
    try:
        created = ingest_file(db, project_id, file.filename, data)
    except DuplicateRequirementError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except IngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    record_event(
        db,
        actor="local-user",
        action="requirement.upload",
        resource=f"project:{project_id}",
        correlation_id=new_correlation_id(),
        filename=file.filename,
        requirements_created=len(created),
        requirement_ids=[r.id for r in created],
    )
    return created


@router.get("/projects/{project_id}/requirements", response_model=list[RequirementOut])
def list_requirements(project_id: str, db: Session = Depends(get_db)) -> list[Requirement]:
    """List a project's requirements, oldest first."""
    _get_project_or_404(db, project_id)
    return list(
        db.scalars(
            select(Requirement)
            .where(Requirement.project_id == project_id)
            .order_by(Requirement.created_at)
        ).all()
    )


@router.get("/requirements/{requirement_id}/history")
def get_requirement_history(requirement_id: str, db: Session = Depends(get_db)) -> dict:
    """Full generation history of one requirement (FR-AUD-003)."""
    history = requirement_history(db, requirement_id)
    if history is None:
        raise HTTPException(
            status_code=404, detail=f"Requirement {requirement_id!r} not found."
        )
    return history
