"""Local execution orchestration service (SRS FR-EXE-001..005, FR-RES-001).

Creates an ``ExecutionRun`` row, drives pytest/Playwright synchronously via
``tools.playwright_execution`` (MVP), parses the JUnit report into
``TestResult`` rows with linked evidence (FR-AUT-008), and records
environment / browser / headed metadata (FR-EXE-001/003). Per-test browser
isolation comes for free from pytest-playwright's fresh context per test
(FR-EXE-002). Cancellation terminates the child process group (FR-EXE-005).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import redact_secrets
from app.models.entities import ExecutionRun, Project, TestCase, TestResult
from app.models.schemas import ExecutionRequest
from app.services.results import collect_evidence, parse_junit
from tools.playwright_execution import REPO_ROOT, cancel_run, run_pytest

logger = get_logger(__name__)

SUPPORTED_BROWSERS = {"chromium", "firefox", "webkit"}

# Traceability marker written by the automation agent into generated tests,
# e.g. "# TC: TC-001" directly above/inside a test function (FR-AUT-002).
_TC_COMMENT_RE = re.compile(r"#\s*TC:\s*([A-Za-z0-9_\-]+)")
_DEF_RE_TEMPLATE = r"^\s*(?:async\s+)?def\s+{name}\s*\("

_LOG_TAIL_CHARS = 2000
_TC_SCAN_WINDOW_ABOVE = 8  # lines of decorators/comments above the def
_TC_SCAN_WINDOW_BELOW = 8  # lines of docstring/body below the def


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _slugify(value: str) -> str:
    """Approximate pytest-playwright's artifact-directory slug for matching."""
    return re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()


def _log_tail(log_path: str | Path) -> str:
    """Return the redacted tail of the pytest log for infra-error diagnosis (§17)."""
    try:
        text = Path(log_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return redact_secrets(text[-_LOG_TAIL_CHARS:])


def _test_file_from_node_id(node_id: str) -> Path | None:
    """Resolve the source file of a pytest node id, best effort."""
    file_part = node_id.partition("::")[0]
    if not file_part:
        return None
    candidates = []
    if file_part.endswith(".py"):
        candidates.append(Path(file_part))
    else:  # dotted module form, e.g. automation.generated_tests.test_login
        candidates.append(Path(file_part.replace(".", "/") + ".py"))
    for candidate in candidates:
        path = candidate if candidate.is_absolute() else REPO_ROOT / candidate
        if path.is_file():
            return path
    return None


def _resolve_test_case_id(db: Session, project_id: str, node_id: str) -> str | None:
    """Link a pytest node id back to a stored TestCase via its '# TC:' marker.

    Scans the test source for a ``# TC: <key-or-id>`` comment in a small
    window around the test function definition (traceability, FR-TC-001 /
    FR-RES-001). Returns None when the file, marker or test case cannot be
    resolved — results are still stored, just unlinked.
    """
    path = _test_file_from_node_id(node_id)
    if path is None:
        return None
    test_name = node_id.split("::")[-1].split("[")[0].strip()
    if not test_name:
        return None
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None

    def_re = re.compile(_DEF_RE_TEMPLATE.format(name=re.escape(test_name)))
    token: str | None = None
    for idx, line in enumerate(lines):
        if not def_re.match(line):
            continue
        window = lines[max(0, idx - _TC_SCAN_WINDOW_ABOVE) : idx + _TC_SCAN_WINDOW_BELOW + 1]
        for candidate in window:
            match = _TC_COMMENT_RE.search(candidate)
            if match:
                token = match.group(1)
                break
        break
    if token is None:
        return None

    case = db.scalars(
        select(TestCase).where(TestCase.project_id == project_id, TestCase.case_key == token)
    ).first()
    if case is None:
        case = db.get(TestCase, token)
        if case is not None and case.project_id != project_id:
            case = None
    return case.id if case else None


def _match_evidence(
    node_id: str, evidence: dict[str, dict[str, list[str]]]
) -> dict[str, list[str]]:
    """Match a test's node id to its pytest-playwright evidence folder (FR-AUT-008)."""
    if not evidence:
        return {}
    full_slug = _slugify(node_id)
    if full_slug:
        for slug in evidence:
            if slug.startswith(full_slug) or full_slug in slug:
                return evidence[slug]
    file_part, _, test_part = node_id.partition("::")
    test_name = (test_part or node_id).split("::")[-1].split("[")[0]
    name_slug = _slugify(test_name)
    if not name_slug:
        return {}
    candidates = [slug for slug in evidence if name_slug in slug]
    if len(candidates) > 1 and file_part:
        stem_slug = _slugify(Path(file_part).stem)
        narrowed = [slug for slug in candidates if stem_slug and stem_slug in slug]
        candidates = narrowed or candidates
    return evidence[candidates[0]] if candidates else {}


def start_local_execution(db: Session, project_id: str, request: ExecutionRequest) -> ExecutionRun:
    """Run approved tests locally and persist structured results.

    Implements FR-EXE-001 (environment selection via env vars), FR-EXE-003
    (browser/headed configuration), FR-EXE-004 (metrics), FR-RES-001 (per-test
    results) and FR-AUT-008 (evidence attachment). Runs pytest synchronously
    (MVP) but registers the child process so ``cancel_execution`` works from
    another thread (FR-EXE-005). Per §17: a nonzero exit *with* a JUnit report
    means ordinary test failures (run 'completed'); a missing report means an
    infrastructure error (run 'error' with the redacted log tail in
    ``metrics.error``).

    Args:
        db: Open SQLAlchemy session.
        project_id: Owning project id.
        request: Execution parameters (paths, browser, headed, markers, env).

    Returns:
        The finished ``ExecutionRun`` row (status completed|error|cancelled).

    Raises:
        ValueError: If the requested browser is not a Playwright browser.
    """
    if request.browser not in SUPPORTED_BROWSERS:
        raise ValueError(
            f"unsupported browser {request.browser!r}; expected one of {sorted(SUPPORTED_BROWSERS)}"
        )
    settings = get_settings()
    project = db.get(Project, project_id)

    run = ExecutionRun(
        project_id=project_id,
        mode="local",
        status="running",
        environment=request.environment,  # FR-EXE-001
        browser=request.browser,  # FR-EXE-003
        headed=request.headed,
        started_at=_now(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    run_dir = settings.artifacts_path / run.id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Environment injection (FR-EXE-001): generated tests read the target URL
    # and credentials from env vars only — never from prompts or argv
    # (FR-PROJ-004, FR-CI-004).
    target_base_url = (project.base_url if project and project.base_url else "") or settings.target_base_url
    extra_env = {"QA_TARGET_BASE_URL": target_base_url, "QA_ENVIRONMENT": request.environment}
    if project and project.allowed_domains:
        extra_env["QA_ALLOWED_DOMAINS"] = project.allowed_domains

    test_paths = request.test_paths or [settings.generated_tests_dir]

    logger.info(
        "local execution starting",
        extra={"run_id": run.id, "project_id": project_id},
    )
    result = run_pytest(
        test_paths,
        run_dir,
        headed=request.headed,
        browser=request.browser,
        extra_env=extra_env,
        markers=request.markers,
        run_id=run.id,
    )

    metrics: dict = {
        "exit_code": result["exit_code"],
        "browser": request.browser,
        "headed": request.headed,
        "environment": request.environment,
        "test_paths": test_paths,
    }
    junit_path = Path(result["junit_path"])

    if result["cancelled"]:
        run.status = "cancelled"
        metrics["cancelled"] = True
    elif junit_path.is_file():
        # Nonzero exit + junit present = ordinary test failures (§17).
        try:
            summary = parse_junit(junit_path)
        except Exception as exc:  # malformed XML => infrastructure error
            run.status = "error"
            metrics["error"] = redact_secrets(f"failed to parse junit report: {exc}")
        else:
            evidence = collect_evidence(result["output_dir"])
            for test in summary["tests"]:
                db.add(
                    TestResult(
                        execution_run_id=run.id,
                        test_case_id=_resolve_test_case_id(db, project_id, test["node_id"]),
                        node_id=test["node_id"],
                        outcome=test["outcome"],
                        duration_seconds=test["duration"],
                        error_message=test["message"],
                        evidence=_match_evidence(test["node_id"], evidence),  # FR-AUT-008
                    )
                )
            metrics.update(
                {
                    "passed": summary["passed"],  # FR-EXE-004 metrics
                    "failed": summary["failed"],
                    "skipped": summary["skipped"],
                    "errors": summary["errors"],
                    "total": len(summary["tests"]),
                    "duration_seconds": summary["duration_seconds"],
                }
            )
            run.status = "completed"
            if result.get("timed_out"):
                run.status = "error"
                metrics["error"] = f"run exceeded timeout; partial results parsed. {_log_tail(result['log_path'])}"
    else:
        # No junit at all: pytest never ran to reporting (browser/launch/env
        # crash) — infrastructure error per §17. Store the redacted log tail.
        run.status = "error"
        metrics["error"] = _log_tail(result["log_path"])

    run.metrics = metrics
    run.finished_at = _now()
    db.commit()
    db.refresh(run)
    logger.info(
        "local execution finished with status=%s exit_code=%s",
        run.status,
        result["exit_code"],
        extra={"run_id": run.id, "project_id": project_id},
    )
    return run


def cancel_execution(db: Session, run_id: str) -> bool:
    """Cancel a running local execution (FR-EXE-005).

    Terminates the registered pytest process group and marks the run row
    cancelled immediately; the synchronous runner confirms the same terminal
    state once the process exits.

    Args:
        db: Open SQLAlchemy session.
        run_id: ``ExecutionRun`` id to cancel.

    Returns:
        True if a live process was signalled, False if nothing was running
        under that id (already finished, unknown, or a CI-mode run).
    """
    signalled = cancel_run(run_id)
    if not signalled:
        return False
    run = db.get(ExecutionRun, run_id)
    if run is not None and run.status in {"pending", "running"}:
        run.status = "cancelled"
        run.finished_at = _now()
        db.commit()
    logger.info("execution cancelled", extra={"run_id": run_id})
    return True
