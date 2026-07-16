"""Failure triage endpoints: classify, override, draft defects (SRS §14.2).

POST /results/{id}/classify runs the Result Analysis Agent (FR-RES-002/003)
and stores a :class:`Finding` whose ``ai_classification`` and effective
``classification`` start identical. POST /findings/{id}/override lets a human
change the effective classification while the original AI verdict is kept for
comparison (FR-RES-004). POST /findings/{id}/defect-draft produces a complete
defect report draft (FR-BUG-001) plus duplicate suggestions (FR-BUG-003).
Every mutation records an audit event (FR-AUD-001).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from agents import report_agent, result_analysis_agent
from app.core.llm import OllamaUnavailableError
from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.models.entities import ExecutionRun, Finding, Requirement, TestCase, TestResult
from app.models.schemas import FailureClassificationOutput
from app.services.audit import record_event
from app.services.report_service import find_similar_findings

router = APIRouter(tags=["findings"])

_CLASSIFIABLE_OUTCOMES = {"failed", "error"}


class FindingOverrideRequest(BaseModel):
    """Body of POST /findings/{id}/override (FR-RES-004)."""

    classification: str
    actor: str = "local-user"
    comment: str = ""


def _row_to_dict(obj: Any) -> dict:
    """Serialise an ORM row's column attributes to a plain dict."""
    return {attr.key: getattr(obj, attr.key) for attr in sa_inspect(obj).mapper.column_attrs}


def _flatten_evidence(evidence: dict | None) -> list[str]:
    """Flatten the TestResult.evidence JSON dict into a list of link strings."""
    links: list[str] = []
    for value in (evidence or {}).values():
        if isinstance(value, str) and value:
            links.append(value)
        elif isinstance(value, list):
            links.extend(str(v) for v in value if v)
    return links


def _triage_context(db: Session, result: TestResult) -> tuple[TestCase | None, Requirement | None]:
    """Resolve the linked test case and its first requirement, best effort."""
    case = db.get(TestCase, result.test_case_id) if result.test_case_id else None
    requirement = None
    if case is not None:
        for rid in case.requirement_ids or []:
            requirement = db.get(Requirement, str(rid))
            if requirement is not None:
                break
    return case, requirement


@router.post("/results/{result_id}/classify", status_code=201)
def classify_result(result_id: str, db: Session = Depends(get_db)) -> dict:
    """Classify one failed test result via the Result Analysis Agent (FR-RES-002)."""
    result = db.get(TestResult, result_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Test result {result_id!r} not found.")
    if result.outcome not in _CLASSIFIABLE_OUTCOMES:
        raise HTTPException(
            status_code=400,
            detail=f"Result {result_id!r} has outcome {result.outcome!r}; only "
            f"{sorted(_CLASSIFIABLE_OUTCOMES)} results can be classified.",
        )

    case, requirement = _triage_context(db, result)
    test = {
        "node_id": result.node_id,
        "error_message": result.error_message,
        "duration": result.duration_seconds,
    }
    context = {
        "requirement_text": requirement.text if requirement else "",
        "test_case_title": case.title if case else "",
        "steps": list(case.steps) if case else [],
    }
    try:
        output = result_analysis_agent.classify_failure(test, context)
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    # AI verdict and effective classification start identical (FR-RES-004).
    finding = Finding(
        result_id=result.id,
        classification=output.classification,
        ai_classification=output.classification,
        confidence=output.confidence,
        rationale=output.rationale,
        severity=output.severity,
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    record_event(
        db,
        actor="ai:result_analysis_agent",
        action="result.classify",
        resource=f"finding:{finding.id}",
        correlation_id=new_correlation_id(),
        result_id=result.id,
        classification=output.classification,
        confidence=output.confidence,
    )
    return _row_to_dict(finding)


@router.post("/findings/{finding_id}/override")
def override_finding(
    finding_id: str, body: FindingOverrideRequest, db: Session = Depends(get_db)
) -> dict:
    """Human override of a classification; the AI verdict is kept (FR-RES-004)."""
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Finding {finding_id!r} not found.")
    valid = result_analysis_agent.VALID_CLASSIFICATIONS
    if body.classification not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"classification must be one of {sorted(valid)}.",
        )

    previous = finding.classification
    finding.classification = body.classification  # ai_classification untouched
    finding.overridden_by = body.actor
    db.commit()
    db.refresh(finding)

    record_event(
        db,
        actor=body.actor,
        action="finding.override",
        resource=f"finding:{finding.id}",
        correlation_id=new_correlation_id(),
        previous_classification=previous,
        new_classification=body.classification,
        ai_classification=finding.ai_classification,
        comment=body.comment,
    )
    return _row_to_dict(finding)


@router.post("/findings/{finding_id}/defect-draft", status_code=201)
def draft_defect(finding_id: str, db: Session = Depends(get_db)) -> dict:
    """Draft a defect report for a finding, with duplicate suggestions (FR-BUG-001/003)."""
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Finding {finding_id!r} not found.")
    result = db.get(TestResult, finding.result_id)
    if result is None:
        raise HTTPException(
            status_code=404, detail=f"Test result for finding {finding_id!r} not found."
        )
    run = db.get(ExecutionRun, result.execution_run_id)
    case, requirement = _triage_context(db, result)

    test = {
        "node_id": result.node_id,
        "error_message": result.error_message,
        "duration": result.duration_seconds,
        "steps": list(case.steps) if case else [],
        "title": case.title if case else "",
    }
    classification = FailureClassificationOutput(
        classification=finding.classification,
        confidence=finding.confidence,
        rationale=finding.rationale or "(no rationale recorded)",
        severity=finding.severity,
    )
    requirement_dict = {
        "id": requirement.id if requirement else "",
        "title": requirement.title if requirement else "",
        "text": requirement.text if requirement else "",
    }
    environment = run.environment if run else "local"
    try:
        draft = report_agent.draft_defect(
            test,
            classification,
            requirement_dict,
            evidence_refs=_flatten_evidence(result.evidence),
            environment=environment,
        )
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    finding.report_fields = draft.model_dump()
    db.commit()
    db.refresh(finding)

    # Duplicate suggestions before filing (FR-BUG-003), excluding this finding.
    duplicates = []
    if run is not None:
        duplicates = [
            {
                "finding_id": dup.id,
                "title": str((dup.report_fields or {}).get("title", "")),
                "classification": dup.classification,
                "external_issue_ref": dup.external_issue_ref,
            }
            for dup in find_similar_findings(db, run.project_id, draft.title)
            if dup.id != finding.id
        ]

    record_event(
        db,
        actor="ai:report_agent",
        action="finding.defect_draft",
        resource=f"finding:{finding.id}",
        correlation_id=new_correlation_id(),
        title=draft.title,
        duplicate_candidates=len(duplicates),
    )
    return {
        "finding_id": finding.id,
        "draft": draft.model_dump(),
        "duplicate_candidates": duplicates,
    }
