"""Automation endpoints: generate and validate Playwright test code (SRS §14.2).

POST /test-cases/automation turns approved test cases (FR-HITL — unapproved
cases are refused with 409) into Playwright pytest files via the Automation
Agent (FR-AUT-001..008), writes them safely to disk, runs the validation gate
(FR-VAL-001..005) and stores each file as a :class:`GeneratedArtifact` with
its validation report. POST /artifacts/{id}/validate re-runs the gate.
Every mutation records an audit event (FR-AUD-001).
"""

from __future__ import annotations

import ast
import hashlib
import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from agents import automation_agent
from app.core.config import BASE_DIR, get_settings
from app.core.llm import OllamaUnavailableError, generation_metadata, require_ollama
from app.core.logging import get_logger, new_correlation_id
from app.models.db import get_db
from app.models.entities import GeneratedArtifact, GenerationRun, Project, TestCase
from app.services.audit import record_event
from app.services.validation import validate_paths

logger = get_logger(__name__)

router = APIRouter(tags=["automation"])


class AutomationGenerateRequest(BaseModel):
    """Body of POST /test-cases/automation."""

    test_case_ids: list[str] = Field(min_length=1)


def _row_to_dict(obj: Any) -> dict:
    """Serialise an ORM row's column attributes to a plain dict."""
    return {attr.key: getattr(obj, attr.key) for attr in sa_inspect(obj).mapper.column_attrs}


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _page_objects_summary() -> str:
    """Describe the available page objects for the agent prompt (FR-AUT-003).

    Introspects ``automation/pages/*.py`` with :mod:`ast` — deterministic,
    no code execution.
    """
    pages_dir = BASE_DIR / "automation" / "pages"
    lines: list[str] = []
    for py_file in sorted(pages_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue
        module = f"automation.pages.{py_file.stem}"
        for node in tree.body:
            if not isinstance(node, ast.ClassDef):
                continue
            methods = [
                child.name
                for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                and not child.name.startswith("_")
            ]
            lines.append(
                f"- {module}.{node.name}(page, base_url) — methods: "
                f"{', '.join(methods) if methods else '(none)'}"
            )
    return "\n".join(lines) or "(no page objects available)"


@router.post("/test-cases/automation", status_code=201)
def generate_automation(
    body: AutomationGenerateRequest, db: Session = Depends(get_db)
) -> dict:
    """Generate Playwright tests for approved test cases (FR-AUT-001..008).

    Only test cases with ``review_status='approved'`` may be automated
    (FR-HITL); any other status yields HTTP 409.
    """
    cases: list[TestCase] = []
    for case_id in body.test_case_ids:
        case = db.get(TestCase, case_id)
        if case is None:
            raise HTTPException(status_code=404, detail=f"Test case {case_id!r} not found.")
        cases.append(case)

    unapproved = [c.id for c in cases if c.review_status != "approved"]
    if unapproved:
        raise HTTPException(
            status_code=409,
            detail="Only approved test cases can be automated (FR-HITL); "
            f"these are not approved: {unapproved}. Approve them via "
            "POST /test-cases/{id}/approve first.",
        )
    project_ids = {c.project_id for c in cases}
    if len(project_ids) != 1:
        raise HTTPException(
            status_code=400,
            detail="All test cases must belong to the same project; "
            f"got projects {sorted(project_ids)}.",
        )
    project = db.get(Project, project_ids.pop())
    if project is None:
        raise HTTPException(status_code=404, detail="Owning project not found.")

    try:
        require_ollama()
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None

    settings = get_settings()
    base_url = project.base_url or settings.target_base_url
    case_dicts = [
        {
            "id": c.id,
            "case_key": c.case_key,
            "title": c.title,
            "objective": c.objective,
            "category": c.category,
            "priority": c.priority,
            "preconditions": c.preconditions,
            "test_data": c.test_data,
            "steps": c.steps,
            "expected_results": c.expected_results,
            "requirement_ids": c.requirement_ids,
        }
        for c in cases
    ]

    metadata = generation_metadata()
    run = GenerationRun(
        project_id=project.id,
        kind="automation",
        model=metadata["model"],
        prompt_version=getattr(automation_agent, "PROMPT_VERSION", "v1"),
        parameters=metadata,
        status="pending",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    started = time.perf_counter()
    try:
        output = automation_agent.generate_automation(
            case_dicts, base_url, _page_objects_summary()
        )
        written_paths = automation_agent.write_generated_files(output.files)
    except OllamaUnavailableError as exc:
        run.status, run.error = "error", str(exc)
        run.duration_seconds = round(time.perf_counter() - started, 3)
        db.commit()
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except FileExistsError as exc:
        run.status, run.error = "error", str(exc)
        run.duration_seconds = round(time.perf_counter() - started, 3)
        db.commit()
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except RuntimeError as exc:
        run.status, run.error = "error", str(exc)
        run.duration_seconds = round(time.perf_counter() - started, 3)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from None

    run.status = "success"
    run.duration_seconds = round(time.perf_counter() - started, 3)
    run.input_hash = _sha256(json.dumps(case_dicts, sort_keys=True, default=str))
    run.output_hash = _sha256(
        json.dumps([{"path": f.path, "content": f.content} for f in output.files], sort_keys=True)
    )
    db.commit()

    # Validation gate on the real files (FR-VAL-001..005, SEC-005).
    report = validate_paths(written_paths, allowed_domains=project.allowed_domain_list)
    report_dump = report.model_dump()

    written_by_name = {p.rsplit("/", 1)[-1]: p for p in written_paths}
    artifacts: list[GeneratedArtifact] = []
    for gen_file in output.files:
        path = written_by_name.get(gen_file.path.rsplit("/", 1)[-1], gen_file.path)
        artifact = GeneratedArtifact(
            project_id=project.id,
            type=gen_file.kind or "test_file",
            path=path,
            content=gen_file.content,
            content_hash=_sha256(gen_file.content),
            test_case_ids=gen_file.test_case_ids or [c.id for c in cases],
            generation_run_id=run.id,
            approval_status="draft",
            validation_report=report_dump,
        )
        db.add(artifact)
        artifacts.append(artifact)
    if report.passed:
        for case in cases:
            case.automation_status = "automated"
    db.commit()
    for artifact in artifacts:
        db.refresh(artifact)

    record_event(
        db,
        actor="local-user",
        action="automation.generate",
        resource=f"project:{project.id}",
        result="success" if report.passed else "failure",
        correlation_id=new_correlation_id(),
        generation_run_id=run.id,
        files=written_paths,
        validation_passed=report.passed,
        validation_errors=len(report.errors),
    )
    return {
        "files": [_row_to_dict(a) for a in artifacts],
        "validation_report": report_dump,
        "generation_run": _row_to_dict(run),
    }


@router.post("/artifacts/{artifact_id}/validate")
def revalidate_artifact(artifact_id: str, db: Session = Depends(get_db)) -> dict:
    """Re-run the validation gate on one stored artifact (FR-VAL-001..005)."""
    artifact = db.get(GeneratedArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id!r} not found.")
    project = db.get(Project, artifact.project_id)
    domains = project.allowed_domain_list if project else None

    report = validate_paths([artifact.path], allowed_domains=domains)
    artifact.validation_report = report.model_dump()
    db.commit()
    db.refresh(artifact)

    record_event(
        db,
        actor="local-user",
        action="artifact.validate",
        resource=f"artifact:{artifact.id}",
        result="success" if report.passed else "failure",
        correlation_id=new_correlation_id(),
        path=artifact.path,
        validation_passed=report.passed,
    )
    return {"artifact": _row_to_dict(artifact), "validation_report": report.model_dump()}
