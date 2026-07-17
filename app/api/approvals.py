"""Human-in-the-loop approval endpoints (SRS FR-HITL-001..003).

Records an :class:`Approval` row for generated artifacts, test cases and test
plans, updates the target's status, and writes an audit event per decision
(FR-HITL-003). Rejected artifacts are blocked from execution and commits by
the guards in the executions and git/ci routers (FR-HITL-001). A generated
artifact can only be *approved* when its stored validation report passed
(FR-VAL-005 / SEC-005) — the human gate never overrides the safety gate.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.models.entities import Approval, GeneratedArtifact, TestCase, TestPlan
from app.models.schemas import ApprovalRequest
from app.services.audit import record_event

router = APIRouter(tags=["approvals"])

_VALID_DECISIONS = {"approved", "rejected", "regenerate"}

#: Status written onto the target entity per decision (regenerate -> draft).
_DECISION_TO_STATUS = {"approved": "approved", "rejected": "rejected", "regenerate": "draft"}


def _row_to_dict(obj: Any) -> dict:
    """Serialise an ORM row's column attributes to a plain dict."""
    return {attr.key: getattr(obj, attr.key) for attr in sa_inspect(obj).mapper.column_attrs}


def _apply_decision(
    db: Session,
    body: ApprovalRequest,
    *,
    artefact_id: str,
    artefact_type: str,
    action: str,
) -> Approval:
    """Persist the Approval row and its audit event (FR-HITL-003)."""
    if body.decision not in _VALID_DECISIONS:
        raise HTTPException(
            status_code=400,
            detail=f"decision must be one of {sorted(_VALID_DECISIONS)}.",
        )
    approval = Approval(
        artefact_id=artefact_id,
        artefact_type=artefact_type,
        actor=body.actor,
        decision=body.decision,
        comment=body.comment,
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)
    record_event(
        db,
        actor=body.actor,
        action=action,
        resource=f"{artefact_type}:{artefact_id}",
        correlation_id=new_correlation_id(),
        decision=body.decision,
        comment=body.comment,
        approval_id=approval.id,
    )
    return approval


@router.post("/artifacts/{artifact_id}/approve")
def approve_artifact(
    artifact_id: str, body: ApprovalRequest, db: Session = Depends(get_db)
) -> dict:
    """Approve/reject a generated artifact (FR-HITL-001/003).

    Approval additionally requires a PASSING validation report (FR-VAL-005 /
    SEC-005): an artifact whose ``validation_report`` is missing or has
    ``passed=false`` cannot be approved (HTTP 409) — rejection and
    regeneration remain allowed. Rejected artifacts cannot be executed or
    committed — the executions and git routers enforce
    ``approval_status == 'approved'``.
    """
    artifact = db.get(GeneratedArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id!r} not found.")
    # SEC-005 / FR-VAL-005: the human gate must never override the safety
    # gate — approval is only possible once validation has passed.
    if body.decision == "approved" and not (artifact.validation_report or {}).get("passed"):
        raise HTTPException(
            status_code=409,
            detail=f"Artifact {artifact_id!r} cannot be approved: its validation "
            "report is missing or failing (FR-VAL-005/SEC-005). Re-run "
            "POST /artifacts/{id}/validate and resolve the reported issues "
            "first; rejection remains allowed.",
        )
    approval = _apply_decision(
        db,
        body,
        artefact_id=artifact_id,
        artefact_type="generated_artifact",
        action="artifact.approve",
    )
    artifact.approval_status = _DECISION_TO_STATUS[body.decision]
    db.commit()
    db.refresh(artifact)
    return {"artifact": _row_to_dict(artifact), "approval": _row_to_dict(approval)}


@router.post("/test-cases/{test_case_id}/approve")
def approve_test_case(
    test_case_id: str, body: ApprovalRequest, db: Session = Depends(get_db)
) -> dict:
    """Approve/reject a test case before automation (FR-HITL-002/003)."""
    case = db.get(TestCase, test_case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Test case {test_case_id!r} not found.")
    approval = _apply_decision(
        db,
        body,
        artefact_id=test_case_id,
        artefact_type="test_case",
        action="test_case.approve",
    )
    case.review_status = _DECISION_TO_STATUS[body.decision]
    if body.decision == "regenerate":
        case.revision += 1
    db.commit()
    db.refresh(case)
    return {"test_case": _row_to_dict(case), "approval": _row_to_dict(approval)}


@router.post("/test-plans/{test_plan_id}/approve")
def approve_test_plan(
    test_plan_id: str, body: ApprovalRequest, db: Session = Depends(get_db)
) -> dict:
    """Approve/reject a generated test plan (FR-HITL-002/003)."""
    plan = db.get(TestPlan, test_plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Test plan {test_plan_id!r} not found.")
    approval = _apply_decision(
        db,
        body,
        artefact_id=test_plan_id,
        artefact_type="test_plan",
        action="test_plan.approve",
    )
    plan.approval_status = _DECISION_TO_STATUS[body.decision]
    db.commit()
    db.refresh(plan)
    return {"test_plan": _row_to_dict(plan), "approval": _row_to_dict(approval)}
