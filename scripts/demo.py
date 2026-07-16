"""End-to-end CLI demo of the agentic QA workflow (SRS §7, §15).

Creates (or reuses) a demo project pointing at the sample app on
http://localhost:8001, stores a login-feature requirement, then drives the
LangGraph workflow: requirement analysis -> test plan -> test cases ->
[human approval, FR-HITL-002] -> Playwright code generation -> validation
gate -> [human approval, FR-HITL-001] -> local execution -> failure
classification -> Markdown/HTML report (FR-REP-003).

At every human gate the pending artefacts are printed and the demo asks
``approve? [y/n/comment]`` — unless ``--auto-approve`` is given, in which
case every gate is approved automatically.

Prerequisites:
    * Ollama running locally with the configured model
      (``ollama serve`` + ``ollama pull qwen2.5:latest``).
    * The sample app running: ``.venv/bin/uvicorn sample_app.main:app --port 8001``.

Run:
    .venv/bin/python scripts/demo.py [--auto-approve]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from pathlib import Path

# Allow running as ``python scripts/demo.py`` from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.llm import check_ollama_health  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.models.db import SessionLocal, init_db  # noqa: E402
from app.models.entities import ExecutionRun, Project, Requirement  # noqa: E402
from app.services.ingestion import (  # noqa: E402
    DuplicateRequirementError,
    create_requirement_from_text,
)
from graph.workflow import run_workflow  # noqa: E402

DEMO_PROJECT_NAME = "Sample App Login Demo"
DEMO_ACTOR = "demo-cli"

# ---------------------------------------------------------------------------
# The demo requirement (login feature of sample_app, SRS §15.1)
# ---------------------------------------------------------------------------

LOGIN_REQUIREMENT_TITLE = "User login"

LOGIN_REQUIREMENT_TEXT = """\
The application provides a login page at /login.

The page shows a username field, a password field and a 'Log in' button.
When a registered user submits the correct username and password, the
application redirects to the items page at /items and shows the flash
message 'Welcome'. When the credentials are wrong (unknown username or
incorrect password), the application stays on the login page and shows the
flash message 'Invalid credentials', and no session is created. Submitting
the form with an empty username or an empty password is rejected in the
same way as invalid credentials. The valid test account credentials are
provided through the QA_TEST_USERNAME and QA_TEST_PASSWORD environment
variables and must never appear as literals in test code.
"""

LOGIN_ACCEPTANCE_CRITERIA = [
    "Given valid credentials, when the user submits the login form, the "
    "browser is redirected to /items and the flash message 'Welcome' is shown.",
    "Given an incorrect password, when the user submits the login form, the "
    "user stays on /login and sees the flash message 'Invalid credentials'.",
    "Given an unknown username, the login attempt is rejected with the flash "
    "message 'Invalid credentials'.",
    "Submitting the form with an empty username or an empty password is "
    "rejected like invalid credentials.",
    "Credential values never appear in the page URL or in the page source.",
]

_MAX_FILE_PREVIEW_CHARS = 4000


# ---------------------------------------------------------------------------
# Setup helpers
# ---------------------------------------------------------------------------


def _get_or_create_project(base_url: str) -> str:
    """Return the demo project's id, creating the project on first run."""
    db = SessionLocal()
    try:
        project = db.scalars(
            select(Project).where(Project.name == DEMO_PROJECT_NAME)
        ).first()
        if project is None:
            project = Project(
                name=DEMO_PROJECT_NAME,
                description="Demo project driven by scripts/demo.py (SRS §15)",
                base_url=base_url,
                allowed_domains="localhost,127.0.0.1",
                environment="test",
                created_by=DEMO_ACTOR,
            )
            db.add(project)
            db.commit()
            db.refresh(project)
            print(f"Created project '{DEMO_PROJECT_NAME}' (id={project.id})")
        else:
            print(f"Reusing project '{DEMO_PROJECT_NAME}' (id={project.id})")
        return project.id
    finally:
        db.close()


def _get_or_create_requirement(project_id: str) -> str:
    """Store the login requirement, reusing the existing row on re-runs."""
    db = SessionLocal()
    try:
        try:
            requirement = create_requirement_from_text(
                db,
                project_id,
                LOGIN_REQUIREMENT_TITLE,
                LOGIN_REQUIREMENT_TEXT,
                acceptance_criteria=LOGIN_ACCEPTANCE_CRITERIA,
                source="manual",
            )
            print(f"Created requirement '{requirement.title}' (id={requirement.id})")
        except DuplicateRequirementError:
            requirement = db.scalars(
                select(Requirement).where(
                    Requirement.project_id == project_id,
                    Requirement.text == LOGIN_REQUIREMENT_TEXT.strip(),
                )
            ).first()
            print(f"Reusing requirement '{requirement.title}' (id={requirement.id})")
        return requirement.id
    finally:
        db.close()


def _check_environment(base_url: str) -> bool:
    """Verify Ollama and the sample app; returns False when Ollama is unusable."""
    settings = get_settings()
    health = check_ollama_health()
    if not health["available"]:
        print(
            f"ERROR: Ollama is not reachable at {settings.ollama_base_url}.\n"
            f"       Start it with 'ollama serve' and retry. Detail: {health['error']}"
        )
        return False
    if settings.llm_model not in health["models"]:
        print(
            f"ERROR: model '{settings.llm_model}' is not available in Ollama.\n"
            f"       Pull it with 'ollama pull {settings.llm_model}'. "
            f"Available: {health['models']}"
        )
        return False
    print(f"Ollama OK ({settings.llm_model} at {settings.ollama_base_url})")

    try:
        httpx.get(base_url, timeout=2.0)
        print(f"Sample app OK at {base_url}")
    except httpx.HTTPError:
        print(
            f"WARNING: sample app not reachable at {base_url}. Generated tests "
            "will be SKIPPED at execution time.\n"
            "         Start it with: .venv/bin/uvicorn sample_app.main:app --port 8001"
        )
    return True


# ---------------------------------------------------------------------------
# Interrupt rendering + prompting (FR-HITL-001..002)
# ---------------------------------------------------------------------------


def _hr(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def _print_case_approval(payload: dict) -> None:
    """Show the pending test plan summary and test cases (FR-HITL-002)."""
    _hr("HUMAN GATE 1/2 - review generated TEST CASES (FR-HITL-002)")
    plan = payload.get("test_plan") or {}
    if plan:
        print("\nTest plan (summary):")
        for key in ("objectives", "test_types"):
            for entry in plan.get(key) or []:
                print(f"  - [{key}] {entry}")
    cases = payload.get("test_cases") or []
    print(f"\nGenerated test cases ({len(cases)}):")
    for case in cases:
        print(
            f"\n  {case.get('case_key', '?')} [{case.get('category', '?')}/"
            f"{case.get('priority', '?')}] {case.get('title', '')}"
        )
        for i, step in enumerate(case.get("steps") or [], 1):
            print(f"      {i}. {step}")
        for expected in case.get("expected_results") or []:
            print(f"      => {expected}")
    duplicates = payload.get("duplicate_pairs") or []
    if duplicates:
        print("\nPossible duplicate pairs (FR-TC-004):")
        for pair in duplicates:
            print(f"  - {pair['a']} ~ {pair['b']} (similarity {pair['similarity']})")
    _print_pending_errors(payload)


def _print_code_approval(payload: dict) -> None:
    """Show the pending generated code and its validation report (FR-HITL-001)."""
    _hr("HUMAN GATE 2/2 - review GENERATED CODE before execution (FR-HITL-001)")
    report = payload.get("validation_report") or {}
    verdict = "PASSED" if report.get("passed") else "FAILED"
    attempts = payload.get("automation_attempts", "?")
    print(f"\nValidation gate: {verdict} (generation attempts: {attempts})")
    for issue in report.get("issues") or []:
        print(
            f"  [{issue.get('severity', '?'):7s}] {issue.get('check', '?'):10s} "
            f"{issue.get('location', '')} - {issue.get('message', '')}"
        )
    files = payload.get("generated_files") or []
    print(f"\nGenerated files ({len(files)}) - nothing is on disk or executed yet:")
    for file_dict in files:
        content = str(file_dict.get("content", ""))
        print(f"\n--- {file_dict.get('path', '?')} ({len(content)} chars) ---")
        print(content[:_MAX_FILE_PREVIEW_CHARS])
        if len(content) > _MAX_FILE_PREVIEW_CHARS:
            print(f"... (truncated, {len(content) - _MAX_FILE_PREVIEW_CHARS} more chars)")
    _print_pending_errors(payload)


def _print_pending_errors(payload: dict) -> None:
    errors = payload.get("errors_so_far") or []
    if errors:
        print("\nNon-fatal errors recorded so far (NFR-REL-001):")
        for error in errors:
            print(f"  ! {error}")


def _print_interrupt(payload: object) -> None:
    if isinstance(payload, dict) and payload.get("stage") == "case_approval":
        _print_case_approval(payload)
    elif isinstance(payload, dict) and payload.get("stage") == "code_approval":
        _print_code_approval(payload)
    else:  # unknown gate: show it raw rather than hide it
        _hr("HUMAN GATE - workflow paused")
        print(json.dumps(payload, indent=2, default=str))


def _ask_decision(auto_approve: bool) -> dict[str, str]:
    """Prompt the human for a decision; map free text onto ApprovalRequest.

    y/yes -> approved, n/no -> rejected, r/regenerate -> regenerate;
    any other non-empty text approves WITH that text stored as the comment.
    """
    if auto_approve:
        print("\n--auto-approve: gate approved automatically.")
        return {
            "decision": "approved",
            "actor": DEMO_ACTOR,
            "comment": "auto-approved via --auto-approve",
        }
    print("\n  y = approve   n = reject (stop)   r = regenerate   other text = approve with comment")
    answer = input("approve? [y/n/comment] ").strip()
    lowered = answer.lower()
    if lowered in {"", "y", "yes"}:
        return {"decision": "approved", "actor": DEMO_ACTOR, "comment": ""}
    if lowered in {"n", "no"}:
        return {"decision": "rejected", "actor": DEMO_ACTOR, "comment": ""}
    if lowered in {"r", "regen", "regenerate"}:
        return {"decision": "regenerate", "actor": DEMO_ACTOR, "comment": ""}
    return {"decision": "approved", "actor": DEMO_ACTOR, "comment": answer}


# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------


def _print_summary(state: dict) -> int:
    """Print the run outcome; returns the process exit code."""
    _hr("WORKFLOW FINISHED")
    print(f"Final stage : {state.get('current_stage', '(unknown)')}")

    run_id = state.get("execution_run_id") or ""
    if run_id:
        db = SessionLocal()
        try:
            run = db.get(ExecutionRun, run_id)
            if run is not None:
                metrics = run.metrics or {}
                print(
                    f"Execution   : run {run.id} status={run.status} "
                    f"passed={metrics.get('passed', '?')} failed={metrics.get('failed', '?')} "
                    f"skipped={metrics.get('skipped', '?')} errors={metrics.get('errors', '?')}"
                )
        finally:
            db.close()

    classifications = state.get("classifications") or []
    if classifications:
        print("Failure classifications (FR-RES-002):")
        for item in classifications:
            print(
                f"  - {item.get('node_id', '?')}: {item.get('classification', '?')} "
                f"(confidence {item.get('confidence', '?')})"
            )

    errors = state.get("errors") or []
    if errors:
        print(f"\nErrors recorded during the run ({len(errors)}, NFR-REL-001):")
        for error in errors:
            print(f"  ! {error}")

    report_paths = state.get("report_paths") or {}
    if report_paths:
        print("\nReports (FR-REP-003):")
        print(f"  Markdown : {report_paths.get('markdown', '(missing)')}")
        print(f"  HTML     : {report_paths.get('html', '(missing)')}")
        return 0
    print("\nNo report was generated (workflow rejected or execution skipped).")
    return 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="End-to-end demo of the agentic QA workflow (SRS §7)."
    )
    parser.add_argument(
        "--auto-approve",
        action="store_true",
        help="approve both human gates automatically (unattended demo)",
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8001",
        help="base URL of the sample app under test (default: %(default)s)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="show INFO-level structured logs while the workflow runs",
    )
    args = parser.parse_args(argv)

    configure_logging(logging.INFO if args.verbose else logging.WARNING)
    init_db()

    _hr("Agentic AI QA System - end-to-end demo")
    if not _check_environment(args.base_url):
        return 2

    project_id = _get_or_create_project(args.base_url)
    _get_or_create_requirement(project_id)

    thread_id = uuid.uuid4().hex[:12]
    print(f"\nStarting workflow (thread_id={thread_id}). Stages: analyse -> plan -> "
          "cases -> approve -> code -> validate -> approve -> execute -> classify -> report")
    print("The first LLM stages can take a few minutes on a local model...")

    state = run_workflow(project_id, thread_id)
    while state.get("__interrupt__"):
        for pending in state["__interrupt__"]:
            _print_interrupt(getattr(pending, "value", pending))
        decision = _ask_decision(args.auto_approve)
        print(f"Resuming with decision '{decision['decision']}' ...")
        state = run_workflow(project_id, thread_id, resume_value=decision)

    return _print_summary(state)


if __name__ == "__main__":
    raise SystemExit(main())
