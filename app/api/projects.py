"""Project endpoints (SRS §14.2, FR-PROJ-001..003, FR-AUD-001).

Create, list, fetch and update (rename / archive / reopen) projects.
Project configuration is validated on write: ``base_url`` must be a parseable
http(s) URL (FR-PROJ-002) and the domain allow-list must be non-empty
(FR-PROJ-003). Every mutation records an audit event (FR-AUD-001).
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.models.entities import Project
from app.models.schemas import ProjectCreate, ProjectOut, ProjectUpdate
from app.services.audit import record_event

router = APIRouter(prefix="/projects", tags=["projects"])

_VALID_STATUSES = {"active", "archived"}


def _validate_config(base_url: str, allowed_domains: str) -> None:
    """Validate project configuration on write (FR-PROJ-002/003)."""
    if base_url:
        parsed = urlparse(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(
                status_code=400,
                detail=f"base_url {base_url!r} is not a valid http(s) URL "
                "(expected e.g. http://localhost:8001) (FR-PROJ-002).",
            )
    domains = [d.strip() for d in (allowed_domains or "").split(",") if d.strip()]
    if not domains:
        raise HTTPException(
            status_code=400,
            detail="allowed_domains must contain at least one domain "
            "(comma-separated, e.g. 'localhost,127.0.0.1') (FR-PROJ-003).",
        )


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)) -> Project:
    """Create a project with validated configuration (FR-PROJ-001/002/003)."""
    _validate_config(body.base_url, body.allowed_domains)
    project = Project(**body.model_dump())
    db.add(project)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail=f"A project named {body.name!r} already exists."
        ) from None
    db.refresh(project)
    record_event(
        db,
        actor=project.created_by,
        action="project.create",
        resource=f"project:{project.id}",
        correlation_id=new_correlation_id(),
        name=project.name,
    )
    return project


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[Project]:
    """List all projects, newest first."""
    return list(db.scalars(select(Project).order_by(Project.created_at.desc())).all())


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)) -> Project:
    """Fetch one project by id."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found.")
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)
) -> Project:
    """Rename, reconfigure, archive or reopen a project (FR-PROJ-001).

    ``status`` may only transition between ``active`` and ``archived``;
    configuration fields are re-validated when supplied (FR-PROJ-002/003).
    """
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found.")

    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields supplied to update.")
    if "status" in updates and updates["status"] not in _VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {sorted(_VALID_STATUSES)} "
            "(archive/reopen, FR-PROJ-001).",
        )
    _validate_config(
        updates.get("base_url", project.base_url),
        updates.get("allowed_domains", project.allowed_domains),
    )

    for field, value in updates.items():
        setattr(project, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail=f"A project named {updates.get('name')!r} already exists."
        ) from None
    db.refresh(project)

    action = "project.update"
    if updates.get("status") == "archived":
        action = "project.archive"
    elif updates.get("status") == "active":
        action = "project.reopen"
    record_event(
        db,
        actor=project.created_by,
        action=action,
        resource=f"project:{project.id}",
        correlation_id=new_correlation_id(),
        changed_fields=sorted(updates),
    )
    return project
