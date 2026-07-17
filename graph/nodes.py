"""Workflow nodes: thin, fault-tolerant wrappers around agents and services.

Each node takes the :class:`~graph.state.QAWorkflowState` and returns a
*partial* state update (SRS §6.2). Failures inside a node are caught and
appended to ``state["errors"]`` instead of raised, so one broken stage never
crashes the whole workflow (NFR-REL-001) — the graph keeps flowing and the
human gates / final report surface what went wrong.

The two approval nodes use :func:`langgraph.types.interrupt` to pause the
graph for a human decision (FR-HITL-001..003). ``interrupt()`` raises a
``GraphInterrupt`` internally, so it is deliberately called OUTSIDE any
``try/except`` — the pause must propagate, never be swallowed. Generated
code is held in state (not on disk) until the human approves it, and only
``execute_tests`` writes and runs it (FR-HITL-001: pause before code is
committed/executed; SEC-005).
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from langgraph.types import interrupt
from sqlalchemy import select
from sqlalchemy.orm import Session

from agents import (
    automation_agent,
    report_agent,
    requirement_agent,
    result_analysis_agent,
    test_case_agent,
    test_plan_agent,
)
from app.core.config import get_settings
from app.core.llm import generation_metadata
from app.core.logging import get_logger
from app.models.db import SessionLocal
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
from app.models.schemas import (
    ExecutionRequest,
    GeneratedFile,
    TestCaseOutput,
    ValidationIssue,
    ValidationReport,
)
from app.services import report_service
from app.services.execution import start_local_execution
from app.services.validation import validate_generated_code
from graph.state import QAWorkflowState

logger = get_logger(__name__)

#: Minimum cases requested per requirement (FR-TC-003 coverage; SRS §18 AC3
#: demands >= 10 cases per requirement).
MIN_CASES_PER_REQUIREMENT = 10

#: Human-readable inventory of page objects fed to the Automation Agent
#: (FR-AUT-001; kept in sync with automation/pages/ and automation/conftest.py).
PAGE_OBJECTS_SUMMARY = """\
- automation.pages.sample_login_page.SampleLoginPage(page, base_url) — login page at '/login'.
  Locators: username_input, password_input, submit_button (role 'button', name 'Log in'), flash.
  Methods: goto(), login(username, password), assert_flash_contains(text).
- automation.pages.sample_items_page.SampleItemsPage(page, base_url) — items page at '/items'.
  Methods: goto(), add_item(text), delete_item(index=0), item_with_text(text),
  assert_item_present(text), assert_item_absent(text).
Pytest fixtures available to every test (automation/conftest.py): base_url (str),
credentials (attributes .username / .password), target_available (request it in
every test so suites skip cleanly when the target app is down).\
"""

_VALID_DECISIONS = {"approved", "rejected", "regenerate"}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_payload(payload: Any) -> str:
    """Stable sha256 of a JSON-serialisable payload (NFR-EXP-001).

    Mirrors ``app.api.generation._sha256_of`` so hashes recorded by the graph
    path and the API path are comparable for identical inputs/outputs.
    """
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _new_generation_run(
    db: Session, project_id: str, kind: str, prompt_version: str
) -> GenerationRun:
    """Create a pending :class:`GenerationRun` row for one agent invocation.

    The graph path persists the same reproducibility record as the API path
    (NFR-EXP-001): kind, effective model metadata, prompt version, duration
    and sha256 input/output hashes are filled in by :func:`_finish_generation_run`.
    """
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
    db.flush()  # assign run.id so domain rows can link generation_run_id
    return run


def _finish_generation_run(
    run: GenerationRun,
    *,
    started: float,
    input_payload: Any = None,
    output_payload: Any = None,
    error: str = "",
) -> None:
    """Record duration, hashes and terminal status on a generation run."""
    run.duration_seconds = round(time.perf_counter() - started, 3)
    if error:
        run.status = "error"
        run.error = error
    else:
        run.status = "success"
        run.input_hash = _sha256_payload(input_payload)
        run.output_hash = _sha256_payload(output_payload)


def _requirement_dict(req: Requirement) -> dict[str, Any]:
    return {
        "id": req.id,
        "title": req.title,
        "text": req.text,
        "acceptance_criteria": list(req.acceptance_criteria or []),
    }


def _load_requirements(db: Session, state: QAWorkflowState) -> list[Requirement]:
    """Load the requirements in scope: explicit ids first, else whole project."""
    wanted = list(state.get("requirement_ids") or [])
    if wanted:
        rows = [db.get(Requirement, rid) for rid in wanted]
        return [r for r in rows if r is not None]
    return list(
        db.scalars(
            select(Requirement)
            .where(Requirement.project_id == state["project_id"])
            .order_by(Requirement.created_at)
        ).all()
    )


def _project_domains(db: Session, project_id: str) -> list[str]:
    """Project domain allow-list with settings fallback (FR-VAL-004)."""
    project = db.get(Project, project_id)
    if project is not None and project.allowed_domains:
        return project.allowed_domain_list
    return get_settings().allowed_domain_list


def normalise_decision(raw: object) -> dict[str, str]:
    """Coerce an interrupt resume value into ``{decision, actor, comment}``.

    Accepts the :class:`~app.models.schemas.ApprovalRequest` shape (dict),
    a bare string ('y', 'approved', 'regenerate', ...) or a bool. Anything
    unrecognised is treated as *rejected* — the safe default for a gate that
    protects code execution (FR-HITL-001).
    """
    if isinstance(raw, dict):
        decision = str(raw.get("decision", "")).strip().lower()
        actor = str(raw.get("actor") or "local-user")
        comment = str(raw.get("comment") or "")
    elif isinstance(raw, bool):
        decision, actor, comment = ("approved" if raw else "rejected"), "local-user", ""
    else:
        decision, actor, comment = str(raw).strip().lower(), "local-user", ""

    if decision in {"y", "yes", "approve", "approved", "ok", "true"}:
        decision = "approved"
    elif decision in {"r", "regen", "regenerate", "retry"}:
        decision = "regenerate"
    elif decision not in _VALID_DECISIONS:
        decision = "rejected"
    return {"decision": decision, "actor": actor, "comment": comment}


def _record_approval(
    db: Session,
    *,
    artefact_ids: list[str],
    artefact_type: str,
    decision: dict[str, str],
    project_id: str,
    stage: str,
) -> None:
    """Persist Approval rows + one AuditEvent for a HITL decision (FR-HITL-003)."""
    for artefact_id in artefact_ids or ["(none)"]:
        db.add(
            Approval(
                artefact_id=artefact_id[:32],
                artefact_type=artefact_type,
                actor=decision["actor"],
                decision=decision["decision"],
                comment=decision["comment"],
            )
        )
    db.add(
        AuditEvent(
            actor=decision["actor"],
            action=f"approval.{stage}",
            resource=f"project:{project_id}",
            result=decision["decision"],
            event_metadata={
                "comment": decision["comment"],
                "artefact_type": artefact_type,
                "artefact_count": len(artefact_ids),
            },
        )
    )


# ---------------------------------------------------------------------------
# 1. Requirement analysis (FR-RA-001..004)
# ---------------------------------------------------------------------------


def analyse_requirements(state: QAWorkflowState) -> dict[str, Any]:
    """Analyse every in-scope requirement via the Requirement Agent.

    Persists one :class:`Analysis` row per requirement and returns the
    serialised analyses keyed by requirement id. Per-requirement failures
    are recorded in ``errors`` and the remaining requirements still run
    (NFR-REL-001).
    """
    errors: list[str] = []
    analyses: dict[str, dict[str, Any]] = {}
    requirement_ids: list[str] = list(state.get("requirement_ids") or [])
    db = SessionLocal()
    try:
        requirements = _load_requirements(db, state)
        requirement_ids = [r.id for r in requirements]
        if not requirements:
            errors.append("analyse_requirements: project has no requirements to analyse")
        for req in requirements:
            try:
                result = requirement_agent.analyse_requirement(
                    req.text, list(req.acceptance_criteria or []), requirement_id=req.id
                )
                dump = result.model_dump()
                analyses[req.id] = dump
                db.add(
                    Analysis(
                        requirement_id=req.id,
                        structured_output=dump,
                        assumptions=dump.get("assumptions", []),
                        gaps=[i.get("issue", "") for i in dump.get("issues", [])],
                        risk=dump.get("risk", {}),
                        model_metadata=generation_metadata(),
                    )
                )
                req.status = "analysed"
            except Exception as exc:  # noqa: BLE001 — degrade, don't crash (NFR-REL-001)
                errors.append(f"analyse_requirements[{req.id}]: {exc}")
        db.commit()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"analyse_requirements: {exc}")
    finally:
        db.close()
    logger.info(
        "analyse_requirements: %d/%d analysed", len(analyses), len(requirement_ids),
        extra={"project_id": state.get("project_id")},
    )
    return {
        "analyses": analyses,
        "requirement_ids": requirement_ids,
        "errors": errors,
        "current_stage": "analyse_requirements",
    }


# ---------------------------------------------------------------------------
# 2. Test plan (FR-TP-001..003)
# ---------------------------------------------------------------------------


def generate_plan(state: QAWorkflowState) -> dict[str, Any]:
    """Generate and persist the project test plan (FR-TP-001..002).

    Persists a :class:`GenerationRun` (kind ``test_plan``) alongside the plan
    so the graph path carries the same reproducibility record as the API path
    (NFR-EXP-001).
    """
    errors: list[str] = []
    plan_dump: dict[str, Any] | None = None
    db = SessionLocal()
    try:
        project = db.get(Project, state["project_id"])
        requirements = [_requirement_dict(r) for r in _load_requirements(db, state)]
        analyses = list((state.get("analyses") or {}).values())
        project_name = project.name if project else state["project_id"]
        base_url = (project.base_url if project else "") or get_settings().target_base_url

        run = _new_generation_run(
            db, state["project_id"], "test_plan", test_plan_agent.PROMPT_VERSION
        )
        started = time.perf_counter()
        try:
            plan = test_plan_agent.generate_test_plan(
                project_name, base_url, requirements, analyses
            )
        except Exception as exc:
            _finish_generation_run(run, started=started, error=str(exc))
            db.commit()  # keep the failed-run record (NFR-EXP-001)
            raise
        plan_dump = plan.model_dump()
        _finish_generation_run(
            run,
            started=started,
            input_payload={
                "project": project_name,
                "requirements": requirements,
                "analyses": analyses,
            },
            output_payload=plan_dump,
        )
        db.add(
            TestPlan(
                project_id=state["project_id"],
                content=plan_dump,
                generation_run_id=run.id,
            )
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001 — degrade, don't crash (NFR-REL-001)
        errors.append(f"generate_plan: {exc}")
    finally:
        db.close()
    return {"test_plan": plan_dump, "errors": errors, "current_stage": "generate_plan"}


# ---------------------------------------------------------------------------
# 3. Test cases (FR-TC-001..004)
# ---------------------------------------------------------------------------


def generate_cases(state: QAWorkflowState) -> dict[str, Any]:
    """Generate structured test cases per requirement and persist them.

    Each stored :class:`TestCase` starts as ``review_status='draft'`` —
    only the human gate promotes cases to approved (FR-HITL-002).
    """
    errors: list[str] = []
    case_dicts: list[dict[str, Any]] = []
    analyses = state.get("analyses") or {}
    db = SessionLocal()
    try:
        for req in _load_requirements(db, state):
            run = _new_generation_run(
                db, state["project_id"], "test_cases", test_case_agent.PROMPT_VERSION
            )
            started = time.perf_counter()
            try:
                req_dict = _requirement_dict(req)
                output = test_case_agent.generate_test_cases(
                    req_dict,
                    analyses.get(req.id),
                    min_cases=MIN_CASES_PER_REQUIREMENT,
                )
                output_dump = output.model_dump()
                _finish_generation_run(
                    run,
                    started=started,
                    input_payload={**req_dict, "analysis": analyses.get(req.id)},
                    output_payload=output_dump,
                )
                for case in output.test_cases:
                    row = TestCase(
                        project_id=state["project_id"],
                        requirement_ids=list(case.requirement_ids),
                        case_key=case.case_key,
                        title=case.title,
                        objective=case.objective,
                        category=case.category,
                        priority=case.priority,
                        preconditions=list(case.preconditions),
                        test_data=dict(case.test_data),
                        steps=list(case.steps),
                        expected_results=list(case.expected_results),
                        automation_suitability=case.automation_suitability,
                        review_status="draft",
                        generation_run_id=run.id,
                    )
                    db.add(row)
                    db.flush()  # assign row.id for traceability in state
                    case_dicts.append({"id": row.id, **case.model_dump()})
            except Exception as exc:  # noqa: BLE001 — degrade per requirement
                _finish_generation_run(run, started=started, error=str(exc))
                errors.append(f"generate_cases[{req.id}]: {exc}")
        db.commit()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"generate_cases: {exc}")
    finally:
        db.close()
    return {"test_cases": case_dicts, "errors": errors, "current_stage": "generate_cases"}


# ---------------------------------------------------------------------------
# 4. Human gate: test cases (FR-HITL-002, FR-HITL-003)
# ---------------------------------------------------------------------------


def await_case_approval(state: QAWorkflowState) -> dict[str, Any]:
    """Pause for the human review of the generated test cases (FR-HITL-002).

    Surfaces the pending cases (plus duplicate-pair hints, FR-TC-004) via
    ``interrupt()``; on resume, records the decision as Approval + AuditEvent
    rows (FR-HITL-003) and promotes/demotes ``TestCase.review_status``.
    """
    cases = state.get("test_cases") or []
    duplicates: list[dict[str, Any]] = []
    try:  # payload hints must never block the gate itself
        outputs = [TestCaseOutput.model_validate(c) for c in cases]
        duplicates = [
            {"a": outputs[i].case_key, "b": outputs[j].case_key, "similarity": ratio}
            for i, j, ratio in test_case_agent.find_duplicate_cases(outputs)
        ]
    except Exception:  # noqa: BLE001, S110 — hint-only, safe to omit
        pass

    # interrupt() raises GraphInterrupt on first execution — it must stay
    # OUTSIDE try/except so the pause propagates (FR-HITL-001..002).
    decision = normalise_decision(
        interrupt(
            {
                "stage": "case_approval",
                "question": "Approve the generated test cases?",
                "options": sorted(_VALID_DECISIONS),
                "test_plan": state.get("test_plan"),
                "test_cases": cases,
                "duplicate_pairs": duplicates,
                "errors_so_far": list(state.get("errors") or []),
            }
        )
    )

    errors: list[str] = []
    approved_ids: list[str] = []
    db = SessionLocal()
    try:
        for case_dict in cases:
            case_id = str(case_dict.get("id", ""))
            row = db.get(TestCase, case_id) if case_id else None
            if row is None:
                continue
            if decision["decision"] == "approved":
                row.review_status = "approved"
                approved_ids.append(row.id)
            elif decision["decision"] == "rejected":
                row.review_status = "rejected"
        _record_approval(
            db,
            artefact_ids=[str(c.get("id", "")) for c in cases],
            artefact_type="test_case",
            decision=decision,
            project_id=state["project_id"],
            stage="case_approval",
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"await_case_approval: {exc}")
    finally:
        db.close()
    logger.info(
        "case approval decision=%s by %s (%d cases approved)",
        decision["decision"], decision["actor"], len(approved_ids),
        extra={"project_id": state.get("project_id"), "actor": decision["actor"]},
    )
    return {
        "approved_case_ids": approved_ids,
        "approval_decisions": {"case_approval": decision},
        "errors": errors,
        "current_stage": "await_case_approval",
    }


# ---------------------------------------------------------------------------
# 5. Automation generation (FR-AUT-001..008)
# ---------------------------------------------------------------------------


def generate_automation(state: QAWorkflowState) -> dict[str, Any]:
    """Generate Playwright test files for the approved cases (FR-AUT-001).

    The files are kept in state only — nothing touches the repository until
    the validation gate and the human code approval both pass (SEC-005,
    FR-HITL-001). Draft :class:`GeneratedArtifact` rows record each attempt.
    ``automation_attempts`` feeds the bounded retry loop (NFR-REL-002).
    """
    attempts = int(state.get("automation_attempts") or 0) + 1
    errors: list[str] = []
    files: list[dict[str, Any]] = []
    db = SessionLocal()
    try:
        approved_ids = list(state.get("approved_case_ids") or [])
        if not approved_ids:
            raise ValueError("no approved test cases to automate (FR-HITL-002)")
        rows = [db.get(TestCase, cid) for cid in approved_ids]
        case_dicts = [
            {
                "id": row.id,
                "case_key": row.case_key,
                "title": row.title,
                "steps": list(row.steps or []),
                "expected_results": list(row.expected_results or []),
                "test_data": dict(row.test_data or {}),
                "requirement_ids": list(row.requirement_ids or []),
            }
            for row in rows
            if row is not None and row.automation_suitability != "manual_only"
        ]
        if not case_dicts:
            raise ValueError("all approved cases are manual_only; nothing to automate")

        project = db.get(Project, state["project_id"])
        base_url = (project.base_url if project else "") or get_settings().target_base_url

        run = _new_generation_run(
            db,
            state["project_id"],
            "automation",
            getattr(automation_agent, "PROMPT_VERSION", "v1"),
        )
        started = time.perf_counter()
        try:
            output = automation_agent.generate_automation(
                case_dicts, base_url, PAGE_OBJECTS_SUMMARY
            )
        except Exception as exc:
            _finish_generation_run(run, started=started, error=str(exc))
            db.commit()  # keep the failed-run record (NFR-EXP-001)
            raise
        files = [f.model_dump() for f in output.files]
        _finish_generation_run(
            run,
            started=started,
            input_payload={"test_cases": case_dicts, "base_url": base_url},
            output_payload=files,
        )
        for gen_file in output.files:
            db.add(
                GeneratedArtifact(
                    project_id=state["project_id"],
                    type=gen_file.kind,
                    path=gen_file.path,
                    content=gen_file.content,
                    content_hash=_sha256(gen_file.content),
                    test_case_ids=list(gen_file.test_case_ids),
                    generation_run_id=run.id,
                    approval_status="draft",
                )
            )
        db.commit()
    except Exception as exc:  # noqa: BLE001 — degrade, don't crash (NFR-REL-001)
        errors.append(f"generate_automation(attempt {attempts}): {exc}")
    finally:
        db.close()
    return {
        "generated_files": files,
        "automation_attempts": attempts,
        "validation_report": None,
        "errors": errors,
        "current_stage": "generate_automation",
    }


# ---------------------------------------------------------------------------
# 6. Validation gate (FR-VAL-001..005)
# ---------------------------------------------------------------------------


def validate_code(state: QAWorkflowState) -> dict[str, Any]:
    """Run the full validation gate over the in-memory generated files.

    Static checks + pytest collection in a throw-away mirror (FR-VAL-001..
    005); the report drives the retry loop in the workflow router
    (NFR-REL-002). A gate crash is itself reported as a failing report so
    unvalidated code can never slip through (SEC-005).
    """
    errors: list[str] = []
    files = state.get("generated_files") or []
    try:
        if not files:
            report = ValidationReport(
                passed=False,
                issues=[
                    ValidationIssue(
                        check="collection",
                        severity="error",
                        message="no generated files to validate (generation failed?)",
                    )
                ],
            )
        else:
            db = SessionLocal()
            try:
                domains = _project_domains(db, state["project_id"])
            finally:
                db.close()
            report = validate_generated_code(files, domains, run_collection=True)
    except Exception as exc:  # noqa: BLE001 — a broken gate must fail closed
        errors.append(f"validate_code: {exc}")
        report = ValidationReport(
            passed=False,
            issues=[
                ValidationIssue(
                    check="collection",
                    severity="error",
                    message=f"validation gate crashed: {exc}",
                )
            ],
        )
    return {
        "validation_report": report.model_dump(),
        "errors": errors,
        "current_stage": "validate_code",
    }


# ---------------------------------------------------------------------------
# 7. Human gate: generated code (FR-HITL-001, FR-HITL-003)
# ---------------------------------------------------------------------------


def await_code_approval(state: QAWorkflowState) -> dict[str, Any]:
    """Pause for the human review of generated code before it runs.

    FR-HITL-001: the workflow MUST pause here before any generated code is
    committed or executed — even when validation failed repeatedly, the
    human sees the report and decides (NFR-REL-002). On resume the decision
    is recorded (FR-HITL-003); a 'regenerate' decision resets the retry
    budget so the next loop gets fresh attempts.
    """
    files = state.get("generated_files") or []
    report = state.get("validation_report") or {}

    # interrupt() raises GraphInterrupt on first execution — keep it OUTSIDE
    # try/except so the pause propagates (FR-HITL-001).
    decision = normalise_decision(
        interrupt(
            {
                "stage": "code_approval",
                "question": (
                    "Approve the generated test code for execution? "
                    "Nothing has been written to disk or executed yet."
                ),
                "options": sorted(_VALID_DECISIONS),
                "generated_files": files,
                "validation_report": report,
                "automation_attempts": int(state.get("automation_attempts") or 0),
                "errors_so_far": list(state.get("errors") or []),
            }
        )
    )

    errors: list[str] = []
    db = SessionLocal()
    try:
        status = {"approved": "approved", "rejected": "rejected"}.get(
            decision["decision"], "draft"
        )
        artefact_ids: list[str] = []
        for file_dict in files:
            artifact = db.scalars(
                select(GeneratedArtifact)
                .where(
                    GeneratedArtifact.project_id == state["project_id"],
                    GeneratedArtifact.path == str(file_dict.get("path", "")),
                )
                .order_by(GeneratedArtifact.created_at.desc())
            ).first()
            if artifact is not None:
                artifact.approval_status = status
                artifact.validation_report = report
                artefact_ids.append(artifact.id)
        _record_approval(
            db,
            artefact_ids=artefact_ids,
            artefact_type="generated_code",
            decision=decision,
            project_id=state["project_id"],
            stage="code_approval",
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"await_code_approval: {exc}")
    finally:
        db.close()

    update: dict[str, Any] = {
        "approval_decisions": {"code_approval": decision},
        "errors": errors,
        "current_stage": "await_code_approval",
    }
    if decision["decision"] == "regenerate":
        update["automation_attempts"] = 0  # fresh retry budget (NFR-REL-002)
    return update


# ---------------------------------------------------------------------------
# 8. Execution (FR-EXE-001..005, FR-RES-001)
# ---------------------------------------------------------------------------


def execute_tests(state: QAWorkflowState) -> dict[str, Any]:
    """Write the approved files and run them locally with Playwright.

    This is the only node that writes generated code to disk
    (``write_generated_files``, FR-AUT-007) and executes it
    (``start_local_execution``); it runs strictly after the human approved
    the code (FR-HITL-001) and refuses to act on any other decision.
    """
    errors: list[str] = []
    run_id = ""
    db = SessionLocal()
    try:
        decision = (state.get("approval_decisions") or {}).get("code_approval", {})
        if decision.get("decision") != "approved":
            raise PermissionError(
                "execution blocked: generated code was not approved (FR-HITL-001)"
            )
        files = [GeneratedFile.model_validate(f) for f in state.get("generated_files") or []]
        if not files:
            raise ValueError("no generated files to execute")
        written = automation_agent.write_generated_files(files)  # FR-AUT-007

        project = db.get(Project, state["project_id"])
        request = ExecutionRequest(
            project_id=state["project_id"],
            test_paths=written,
            browser="chromium",
            headed=False,
            environment=(project.environment if project else "") or "local",
        )
        run = start_local_execution(db, state["project_id"], request)
        run_id = run.id
        if run.status == "error":
            errors.append(
                f"execute_tests: run {run.id} finished with status 'error': "
                f"{(run.metrics or {}).get('error', '(no detail)')}"
            )
    except Exception as exc:  # noqa: BLE001 — degrade, don't crash (NFR-REL-001)
        errors.append(f"execute_tests: {exc}")
    finally:
        db.close()
    return {"execution_run_id": run_id, "errors": errors, "current_stage": "execute_tests"}


# ---------------------------------------------------------------------------
# 9. Failure classification (FR-RES-002..003, FR-BUG-001)
# ---------------------------------------------------------------------------


def _failure_inputs(db: Session, result: TestResult) -> tuple[dict, dict, dict]:
    """Build (test, context, requirement) dicts for one failed result."""
    case = db.get(TestCase, result.test_case_id) if result.test_case_id else None
    requirement = None
    if case is not None and case.requirement_ids:
        requirement = db.get(Requirement, str(case.requirement_ids[0]))
    test = {
        "node_id": result.node_id,
        "error_message": result.error_message,
        "duration": result.duration_seconds,
        "steps": list(case.steps or []) if case else [],
        "title": case.title if case else "",
    }
    context = {
        "requirement_text": requirement.text if requirement else "",
        "test_case_title": case.title if case else "",
        "steps": list(case.steps or []) if case else [],
    }
    requirement_dict = {
        "id": requirement.id if requirement else "",
        "title": requirement.title if requirement else "",
        "text": requirement.text if requirement else "",
    }
    return test, context, requirement_dict


def _evidence_refs(evidence: dict | None) -> list[str]:
    refs: list[str] = []
    for value in (evidence or {}).values():
        if isinstance(value, str) and value:
            refs.append(value)
        elif isinstance(value, list):
            refs.extend(str(v) for v in value if v)
    return refs


def classify_failures(state: QAWorkflowState) -> dict[str, Any]:
    """Classify each failed/errored test and persist Findings (FR-RES-002).

    App-defect classifications additionally get a drafted defect report
    stored in ``Finding.report_fields`` (FR-BUG-001) so the final report can
    surface it for human confirmation. Per-failure errors degrade gracefully
    (NFR-REL-001).
    """
    errors: list[str] = []
    classifications: list[dict[str, Any]] = []
    run_id = state.get("execution_run_id") or ""
    if not run_id:
        return {
            "classifications": [],
            "errors": ["classify_failures: no execution run to analyse"],
            "current_stage": "classify_failures",
        }
    db = SessionLocal()
    try:
        run = db.get(ExecutionRun, run_id)
        failures = list(
            db.scalars(
                select(TestResult).where(
                    TestResult.execution_run_id == run_id,
                    TestResult.outcome.in_(("failed", "error")),
                )
            ).all()
        )
        for result in failures:
            try:
                test, context, requirement = _failure_inputs(db, result)
                output = result_analysis_agent.classify_failure(test, context)
                finding = Finding(
                    result_id=result.id,
                    classification=output.classification,
                    ai_classification=output.classification,
                    confidence=output.confidence,
                    rationale=output.rationale,
                    severity=output.severity,
                )
                if output.classification == "app_defect":
                    try:  # defect draft is additive — never blocks triage
                        draft = report_agent.draft_defect(
                            test,
                            output,
                            requirement,
                            _evidence_refs(result.evidence),
                            run.environment if run else "local",
                        )
                        finding.report_fields = draft.model_dump()
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"classify_failures[draft {result.node_id}]: {exc}")
                db.add(finding)
                classifications.append({"node_id": result.node_id, **output.model_dump()})
            except Exception as exc:  # noqa: BLE001 — degrade per failure
                errors.append(f"classify_failures[{result.node_id}]: {exc}")
        db.commit()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"classify_failures: {exc}")
    finally:
        db.close()
    return {
        "classifications": classifications,
        "errors": errors,
        "current_stage": "classify_failures",
    }


# ---------------------------------------------------------------------------
# 10. Report (FR-REP-001..004)
# ---------------------------------------------------------------------------


def generate_report(state: QAWorkflowState) -> dict[str, Any]:
    """Generate the Markdown + HTML execution report (FR-REP-001..004)."""
    errors: list[str] = []
    report_paths: dict[str, str] = {}
    run_id = state.get("execution_run_id") or ""
    if not run_id:
        return {
            "report_paths": {},
            "errors": ["generate_report: no execution run id (execution skipped or failed)"],
            "current_stage": "generate_report",
        }
    db = SessionLocal()
    try:
        result = report_service.generate_report(db, run_id)
        report_paths = {"markdown": result["md_path"], "html": result["html_path"]}
    except Exception as exc:  # noqa: BLE001 — degrade, don't crash (NFR-REL-001)
        errors.append(f"generate_report: {exc}")
    finally:
        db.close()
    return {
        "report_paths": report_paths,
        "errors": errors,
        "current_stage": "generate_report",
    }
