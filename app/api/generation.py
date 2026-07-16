"""AI generation endpoints: analysis, test plan, test cases (SRS §14.2).

Each endpoint checks Ollama availability first (§17 — an unavailable model
returns HTTP 503 with an actionable message), invokes the corresponding
stateless agent, and persists both the domain rows (Analysis / TestPlan /
TestCase) and a :class:`GenerationRun` carrying model metadata, duration and
sha256 input/output hashes (NFR-EXP-001). Every mutation records an audit
event (FR-AUD-001).
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session

from agents import requirement_agent, test_case_agent, test_plan_agent
from app.core.config import get_settings
from app.core.llm import OllamaUnavailableError, generation_metadata, require_ollama
from app.core.logging import get_logger, new_correlation_id
from app.models.db import get_db
from app.models.entities import Analysis, GenerationRun, Project, Requirement, TestCase, TestPlan
from app.services.audit import record_event

logger = get_logger(__name__)

router = APIRouter(tags=["generation"])


def _row_to_dict(obj: Any) -> dict:
    """Serialise an ORM row's column attributes to a plain dict."""
    return {attr.key: getattr(obj, attr.key) for attr in sa_inspect(obj).mapper.column_attrs}


def _sha256_of(payload: Any) -> str:
    """Stable sha256 of a JSON-serialisable payload (NFR-EXP-001)."""
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _new_generation_run(db: Session, project_id: str, kind: str, prompt_version: str) -> GenerationRun:
    metadata = generation_metadata()
    run = GenerationRun(
        project_id=project_id,
        kind=kind,
        model=metadata["model"],
        prompt_version=prompt_version,
        parameters=metadata,
        status="pending",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _finish_run(
    db: Session,
    run: GenerationRun,
    *,
    status: str,
    duration: float,
    input_hash: str = "",
    output_hash: str = "",
    error: str = "",
) -> None:
    run.status = status
    run.duration_seconds = round(duration, 3)
    run.input_hash = input_hash
    run.output_hash = output_hash
    run.error = error
    db.commit()


@router.post("/requirements/{requirement_id}/analyse", status_code=201)
def analyse_requirement(requirement_id: str, db: Session = Depends(get_db)) -> dict:
    """Analyse one requirement via the Requirement Analysis Agent (FR-RA-001..004)."""
    requirement = db.get(Requirement, requirement_id)
    if requirement is None:
        raise HTTPException(
            status_code=404, detail=f"Requirement {requirement_id!r} not found."
        )
    try:
        require_ollama()
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None

    run = _new_generation_run(
        db, requirement.project_id, "analysis", requirement_agent.PROMPT_VERSION
    )
    input_payload = {
        "requirement_id": requirement.id,
        "text": requirement.text,
        "acceptance_criteria": requirement.acceptance_criteria,
    }
    started = time.perf_counter()
    try:
        result = requirement_agent.analyse_requirement(
            requirement.text,
            list(requirement.acceptance_criteria or []),
            requirement_id=requirement.id,
        )
    except OllamaUnavailableError as exc:
        _finish_run(db, run, status="error", duration=time.perf_counter() - started, error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        _finish_run(db, run, status="error", duration=time.perf_counter() - started, error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from None

    output = result.model_dump()
    _finish_run(
        db,
        run,
        status="success",
        duration=time.perf_counter() - started,
        input_hash=_sha256_of(input_payload),
        output_hash=_sha256_of(output),
    )

    analysis = Analysis(
        requirement_id=requirement.id,
        structured_output=output,
        assumptions=output.get("assumptions", []),
        gaps=output.get("issues", []),
        risk=output.get("risk", {}),
        model_metadata={**generation_metadata(), "prompt_version": run.prompt_version},
    )
    requirement.status = "analysed"
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    record_event(
        db,
        actor="local-user",
        action="requirement.analyse",
        resource=f"requirement:{requirement.id}",
        correlation_id=new_correlation_id(),
        analysis_id=analysis.id,
        generation_run_id=run.id,
        risk_score=(output.get("risk") or {}).get("score"),
    )
    return {"analysis": _row_to_dict(analysis), "generation_run": _row_to_dict(run)}


@router.post("/projects/{project_id}/test-plan", status_code=201)
def generate_test_plan(project_id: str, db: Session = Depends(get_db)) -> dict:
    """Generate a project test plan from its requirements (FR-TP-001/002)."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found.")
    requirements = list(
        db.scalars(
            select(Requirement)
            .where(Requirement.project_id == project_id)
            .order_by(Requirement.created_at)
        ).all()
    )
    if not requirements:
        raise HTTPException(
            status_code=400,
            detail="The project has no requirements yet; ingest requirements "
            "before generating a test plan.",
        )
    try:
        require_ollama()
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None

    req_dicts = [
        {
            "id": r.id,
            "title": r.title,
            "text": r.text,
            "acceptance_criteria": r.acceptance_criteria,
        }
        for r in requirements
    ]
    analyses: list[dict] = []
    for r in requirements:
        latest = db.scalars(
            select(Analysis)
            .where(Analysis.requirement_id == r.id)
            .order_by(Analysis.created_at.desc())
        ).first()
        if latest is not None:
            analyses.append(latest.structured_output or {})

    base_url = project.base_url or get_settings().target_base_url
    run = _new_generation_run(db, project_id, "test_plan", test_plan_agent.PROMPT_VERSION)
    started = time.perf_counter()
    try:
        plan = test_plan_agent.generate_test_plan(project.name, base_url, req_dicts, analyses)
    except OllamaUnavailableError as exc:
        _finish_run(db, run, status="error", duration=time.perf_counter() - started, error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        _finish_run(db, run, status="error", duration=time.perf_counter() - started, error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from None

    content = plan.model_dump()
    input_payload = {"project": project.name, "requirements": req_dicts, "analyses": analyses}
    _finish_run(
        db,
        run,
        status="success",
        duration=time.perf_counter() - started,
        input_hash=_sha256_of(input_payload),
        output_hash=_sha256_of(content),
    )

    latest_plan = db.scalars(
        select(TestPlan)
        .where(TestPlan.project_id == project_id)
        .order_by(TestPlan.version.desc())
    ).first()
    version = latest_plan.version + 1 if latest_plan is not None else 1
    test_plan = TestPlan(
        project_id=project_id,
        version=version,
        content=content,
        approval_status="draft",
        generation_run_id=run.id,
    )
    db.add(test_plan)
    db.commit()
    db.refresh(test_plan)

    record_event(
        db,
        actor="local-user",
        action="test_plan.generate",
        resource=f"test_plan:{test_plan.id}",
        correlation_id=new_correlation_id(),
        project_id=project_id,
        version=version,
        generation_run_id=run.id,
    )
    return {"test_plan": _row_to_dict(test_plan), "generation_run": _row_to_dict(run)}


@router.post("/requirements/{requirement_id}/test-cases", status_code=201)
def generate_test_cases(
    requirement_id: str,
    min_cases: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
) -> dict:
    """Generate structured test cases for one requirement (FR-TC-001..003)."""
    requirement = db.get(Requirement, requirement_id)
    if requirement is None:
        raise HTTPException(
            status_code=404, detail=f"Requirement {requirement_id!r} not found."
        )
    try:
        require_ollama()
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None

    req_dict = {
        "id": requirement.id,
        "title": requirement.title,
        "text": requirement.text,
        "acceptance_criteria": requirement.acceptance_criteria,
    }
    latest_analysis = db.scalars(
        select(Analysis)
        .where(Analysis.requirement_id == requirement.id)
        .order_by(Analysis.created_at.desc())
    ).first()
    analysis_dict = latest_analysis.structured_output if latest_analysis is not None else None

    run = _new_generation_run(
        db, requirement.project_id, "test_cases", test_case_agent.PROMPT_VERSION
    )
    started = time.perf_counter()
    try:
        output = test_case_agent.generate_test_cases(req_dict, analysis_dict, min_cases=min_cases)
    except OllamaUnavailableError as exc:
        _finish_run(db, run, status="error", duration=time.perf_counter() - started, error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        _finish_run(db, run, status="error", duration=time.perf_counter() - started, error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from None

    output_dump = output.model_dump()
    _finish_run(
        db,
        run,
        status="success",
        duration=time.perf_counter() - started,
        input_hash=_sha256_of({**req_dict, "analysis": analysis_dict}),
        output_hash=_sha256_of(output_dump),
    )

    # Offset new case keys past existing ones so keys stay unique per project
    # (FR-TC-001). The agent numbers from TC-001 on every invocation.
    existing = db.scalars(
        select(TestCase.case_key).where(TestCase.project_id == requirement.project_id)
    ).all()
    highest = 0
    for key in existing:
        try:
            highest = max(highest, int(str(key).rsplit("-", 1)[-1]))
        except ValueError:
            continue

    cases: list[TestCase] = []
    for index, case in enumerate(output.test_cases, start=1):
        row = TestCase(
            project_id=requirement.project_id,
            requirement_ids=case.requirement_ids,
            case_key=f"TC-{highest + index:03d}",
            title=case.title,
            objective=case.objective,
            category=case.category,
            priority=case.priority,
            preconditions=case.preconditions,
            test_data=case.test_data,
            steps=case.steps,
            expected_results=case.expected_results,
            automation_suitability=case.automation_suitability,
            review_status="draft",
            generation_run_id=run.id,
        )
        db.add(row)
        cases.append(row)
    requirement.status = "covered"
    db.commit()
    for row in cases:
        db.refresh(row)

    duplicates = test_case_agent.find_duplicate_cases(output.test_cases)  # FR-TC-004
    record_event(
        db,
        actor="local-user",
        action="test_cases.generate",
        resource=f"requirement:{requirement.id}",
        correlation_id=new_correlation_id(),
        generation_run_id=run.id,
        cases_created=len(cases),
        duplicate_pairs=len(duplicates),
    )
    return {
        "test_cases": [_row_to_dict(c) for c in cases],
        "duplicate_pairs": [
            {"first": cases[i].id, "second": cases[j].id, "similarity": score}
            for i, j, score in duplicates
            if i < len(cases) and j < len(cases)
        ],
        "generation_run": _row_to_dict(run),
    }
