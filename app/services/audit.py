"""Audit trail service (SRS FR-AUD-001..003).

Records who did what, when, to which resource and with what outcome
(FR-AUD-001), supports filtered queries over the trail (FR-AUD-002) and
reconstructs the full generation history of a requirement — analyses, test
cases and generated artifacts — in chronological order (FR-AUD-003).

Metadata values are secret-redacted before persistence (SEC-007) so the
audit trail can never leak credentials.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import redact_secrets
from app.models.entities import (
    Analysis,
    AuditEvent,
    GeneratedArtifact,
    Requirement,
    TestCase,
)

logger = get_logger(__name__)

#: Hard cap on rows returned by :func:`list_events` (keeps the API bounded).
MAX_EVENTS = 1000
DEFAULT_EVENT_LIMIT = 200


def _row_to_dict(obj: Any) -> dict:
    """Serialise an ORM row's column attributes to a plain dict."""
    return {attr.key: getattr(obj, attr.key) for attr in sa_inspect(obj).mapper.column_attrs}


def _redact_metadata(metadata: dict) -> dict:
    """Redact secret-looking string values in audit metadata (SEC-007)."""
    cleaned: dict = {}
    for key, value in metadata.items():
        cleaned[key] = redact_secrets(value) if isinstance(value, str) else value
    return cleaned


def record_event(
    db: Session,
    actor: str,
    action: str,
    resource: str = "",
    result: str = "success",
    correlation_id: str = "",
    **metadata: Any,
) -> AuditEvent:
    """Persist one audit event (FR-AUD-001).

    Args:
        db: Open SQLAlchemy session (the event is committed immediately so
            an audit record survives even if later work in the request fails).
        actor: Who performed the action (user name or agent identifier).
        action: Dotted action name, e.g. ``project.create``, ``git.commit``.
        resource: Identifier of the affected resource, e.g. ``project:<id>``.
        result: Outcome — ``success`` | ``failure`` | ``denied``.
        correlation_id: Request correlation id linking log lines to the event.
        **metadata: Extra JSON-serialisable context; string values are
            secret-redacted before storage (SEC-007).

    Returns:
        The persisted :class:`AuditEvent`.
    """
    event = AuditEvent(
        actor=actor,
        action=action,
        resource=resource,
        result=result,
        correlation_id=correlation_id,
        event_metadata=_redact_metadata(metadata),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    logger.info(
        "audit: %s %s -> %s",
        action,
        resource,
        result,
        extra={"actor": actor, "correlation_id": correlation_id},
    )
    return event


def list_events(db: Session, filters: dict | None = None) -> list[AuditEvent]:
    """Query the audit trail with optional filters (FR-AUD-001/002).

    Args:
        db: Open SQLAlchemy session.
        filters: Optional dict with any of the keys ``actor``, ``action``,
            ``resource``, ``result``, ``correlation_id`` (exact match),
            ``since`` / ``until`` (:class:`datetime` bounds on ``created_at``)
            and ``limit`` (max rows, capped at :data:`MAX_EVENTS`).

    Returns:
        Matching events, newest first.
    """
    filters = filters or {}
    stmt = select(AuditEvent)
    for field in ("actor", "action", "resource", "result", "correlation_id"):
        value = filters.get(field)
        if value:
            stmt = stmt.where(getattr(AuditEvent, field) == value)
    since = filters.get("since")
    if isinstance(since, datetime):
        stmt = stmt.where(AuditEvent.created_at >= since)
    until = filters.get("until")
    if isinstance(until, datetime):
        stmt = stmt.where(AuditEvent.created_at <= until)

    limit = int(filters.get("limit") or DEFAULT_EVENT_LIMIT)
    limit = max(1, min(limit, MAX_EVENTS))
    stmt = stmt.order_by(AuditEvent.created_at.desc()).limit(limit)
    return list(db.scalars(stmt).all())


def requirement_history(db: Session, requirement_id: str) -> dict | None:
    """Reconstruct a requirement's full generation history (FR-AUD-003).

    Collects the requirement itself, every analysis performed on it, every
    test case that traces back to it and every generated artifact produced
    from those test cases, plus a merged chronological timeline.

    Args:
        db: Open SQLAlchemy session.
        requirement_id: The :class:`Requirement` id to reconstruct.

    Returns:
        ``{"requirement": ..., "analyses": [...], "test_cases": [...],
        "artifacts": [...], "timeline": [...]}`` with the timeline sorted
        oldest-first, or ``None`` when the requirement does not exist.
    """
    requirement = db.get(Requirement, requirement_id)
    if requirement is None:
        return None

    analyses = list(
        db.scalars(
            select(Analysis)
            .where(Analysis.requirement_id == requirement_id)
            .order_by(Analysis.created_at)
        ).all()
    )

    # requirement_ids is a JSON list — filter in Python for SQLite portability.
    project_cases = db.scalars(
        select(TestCase).where(TestCase.project_id == requirement.project_id)
    ).all()
    cases = sorted(
        (c for c in project_cases if requirement_id in (c.requirement_ids or [])),
        key=lambda c: c.created_at,
    )
    case_ids = {c.id for c in cases}

    project_artifacts = db.scalars(
        select(GeneratedArtifact).where(GeneratedArtifact.project_id == requirement.project_id)
    ).all()
    artifacts = sorted(
        (a for a in project_artifacts if case_ids.intersection(a.test_case_ids or [])),
        key=lambda a: a.created_at,
    )

    timeline: list[dict] = [
        {
            "at": requirement.created_at,
            "kind": "requirement",
            "id": requirement.id,
            "summary": f"Requirement v{requirement.version} '{requirement.title}' "
            f"created from source '{requirement.source}'",
        }
    ]
    timeline.extend(
        {
            "at": a.created_at,
            "kind": "analysis",
            "id": a.id,
            "summary": f"Requirement analysed (risk score "
            f"{(a.risk or {}).get('score', 'n/a')})",
        }
        for a in analyses
    )
    timeline.extend(
        {
            "at": c.created_at,
            "kind": "test_case",
            "id": c.id,
            "summary": f"Test case {c.case_key} '{c.title}' "
            f"(review_status={c.review_status})",
        }
        for c in cases
    )
    timeline.extend(
        {
            "at": a.created_at,
            "kind": "artifact",
            "id": a.id,
            "summary": f"Generated {a.type} at {a.path} "
            f"(approval_status={a.approval_status})",
        }
        for a in artifacts
    )
    timeline.sort(key=lambda item: item["at"])

    return {
        "requirement": _row_to_dict(requirement),
        "analyses": [_row_to_dict(a) for a in analyses],
        "test_cases": [_row_to_dict(c) for c in cases],
        "artifacts": [_row_to_dict(a) for a in artifacts],
        "timeline": timeline,
    }
