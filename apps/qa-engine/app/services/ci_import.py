"""CI result import service (SRS §18 item 9 / AC9, FR-CI-002/003, FR-RES-001).

Turns a finished GitHub Actions workflow run into a CI-mode
:class:`~app.models.entities.ExecutionRun`: the run status is fetched via
``tools.github_actions`` (FR-CI-002), every non-expired artifact is downloaded
and extracted under ``<artifacts>/ci/<ci_run_id>/`` (FR-CI-003), and one
``junit*.xml`` (an exact ``junit.xml`` preferred over per-suite reports) is
parsed with :func:`app.services.results.parse_junit`
into :class:`~app.models.entities.TestResult` rows plus aggregate metrics
(FR-RES-001, FR-EXE-004). A run without a JUnit report is still imported —
the absence is noted in ``metrics`` instead of failing the import.

Tokens never pass through this layer: ``tools.github_actions`` reads
``GITHUB_TOKEN`` from the environment only (SEC-002, FR-CI-004).
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import redact_secrets
from app.models.entities import ExecutionRun, TestResult
from app.services.execution import _resolve_test_case_id
from app.services.results import parse_junit
from tools import github_actions

logger = get_logger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _map_status(gh_status: str | None, conclusion: str | None) -> str:
    """Map a GitHub Actions run status/conclusion onto ExecutionRun.status.

    Per §17 semantics: a completed CI run whose only problem is failing tests
    is upgraded to ``completed`` later, once a JUnit report has been parsed —
    the raw conclusion mapping here treats any non-success conclusion as an
    error until results prove otherwise.
    """
    if gh_status in {"queued", "in_progress", "waiting", "requested", "pending"}:
        return "running"
    if gh_status == "completed":
        if conclusion == "success":
            return "completed"
        if conclusion == "cancelled":
            return "cancelled"
        return "error"  # failure | timed_out | action_required | ...
    return "pending"


def _download_artifacts(ci_run_id: int, dest: Path) -> tuple[int, list[str]]:
    """Download and extract every non-expired run artifact (FR-CI-003).

    Returns ``(downloaded_count, notes)``; per-artifact failures are recorded
    as redacted notes instead of aborting the import.
    """
    downloaded = 0
    notes: list[str] = []
    for artifact in github_actions.list_run_artifacts(ci_run_id):
        if artifact.get("expired"):
            notes.append(f"artifact {artifact.get('name')!r} expired; skipped")
            continue
        try:
            github_actions.download_artifact(int(artifact["id"]), dest)
            downloaded += 1
        except Exception as exc:  # noqa: BLE001 — degrade per artifact
            notes.append(
                f"artifact {artifact.get('name')!r} download failed: "
                f"{redact_secrets(str(exc))}"
            )
    return downloaded, notes


def _find_junit_report(dest: Path) -> Path | None:
    """Locate the extracted JUnit report to import, if any.

    The multi-suite CI workflow uploads per-suite reports (``junit-ui.xml``,
    ``junit-api.xml``, ``junit-regression.xml``) alongside the primary
    ``junit.xml`` from the smoke suite; a plain sorted-first pick would
    import ``junit-api.xml`` instead. An exact ``junit.xml`` anywhere in the
    tree therefore wins; otherwise the alphabetically first ``junit*.xml``
    is used as before.
    """
    if not dest.is_dir():
        return None
    candidates = sorted(p for p in dest.rglob("junit*.xml") if p.is_file())
    exact = [p for p in candidates if p.name == "junit.xml"]
    return (exact or candidates)[0] if candidates else None


def import_ci_run(db: Session, project_id: str, ci_run_id: int) -> ExecutionRun:
    """Import one GitHub Actions run as a CI-mode ExecutionRun (AC9).

    Fetches the workflow run (FR-CI-002), creates an ``ExecutionRun`` with
    ``mode='ci'`` / ``environment='ci'`` linked via ``ci_run_id``/``ci_url``
    and ``source_commit`` from the run's head SHA (AC11), downloads its
    artifacts under ``<artifacts>/ci/<ci_run_id>/`` (FR-CI-003) and parses a
    ``junit*.xml`` into ``TestResult`` rows + metrics (FR-RES-001). When no
    JUnit report is present the import still succeeds and the metrics note it.

    Args:
        db: Open SQLAlchemy session.
        project_id: Owning project id.
        ci_run_id: GitHub Actions run identifier.

    Returns:
        The persisted ``ExecutionRun`` row.

    Raises:
        tools.github_actions.GitHubNotConfiguredError: Token/repo missing.
        tools.github_actions.GitHubAPIError: The run status fetch failed.
    """
    status = github_actions.get_workflow_run(ci_run_id)
    gh_status = status.get("status")
    conclusion = status.get("conclusion")

    run = ExecutionRun(
        project_id=project_id,
        mode="ci",
        environment="ci",
        ci_run_id=str(ci_run_id),
        ci_url=str(status.get("html_url") or ""),
        source_commit=str(status.get("head_sha") or ""),  # AC11 provenance
        status=_map_status(gh_status, conclusion),
        started_at=_now(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    metrics: dict = {
        "ci_status": gh_status,
        "ci_conclusion": conclusion,
    }
    notes: list[str] = []

    dest = get_settings().artifacts_path / "ci" / str(ci_run_id)
    try:
        dest.mkdir(parents=True, exist_ok=True)
        downloaded, notes = _download_artifacts(ci_run_id, dest)
        metrics["artifacts_downloaded"] = downloaded
        metrics["artifacts_dir"] = str(dest)
    except Exception as exc:  # noqa: BLE001 — artifacts are best-effort (FR-CI-003)
        notes.append(f"artifact download failed: {redact_secrets(str(exc))}")
        metrics["artifacts_downloaded"] = 0

    junit_path = _find_junit_report(dest)
    if junit_path is None:
        # Graceful degradation: the run is imported, the gap is visible.
        notes.append("no junit*.xml report found in CI artifacts; results not imported")
    else:
        try:
            summary = parse_junit(junit_path)
        except Exception as exc:  # noqa: BLE001 — malformed XML noted, not fatal
            notes.append(f"failed to parse junit report: {redact_secrets(str(exc))}")
        else:
            for test in summary["tests"]:
                db.add(
                    TestResult(
                        execution_run_id=run.id,
                        test_case_id=_resolve_test_case_id(
                            db, project_id, test["node_id"]
                        ),
                        node_id=test["node_id"],
                        outcome=test["outcome"],
                        duration_seconds=test["duration"],
                        error_message=test["message"],
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
                    "junit_report": str(junit_path),
                }
            )
            # §17: a failing CI conclusion with a parsed JUnit report means
            # ordinary test failures, not an infrastructure error.
            if run.status == "error" and conclusion == "failure":
                run.status = "completed"

    if notes:
        metrics["notes"] = notes
    run.metrics = metrics
    if run.status in {"completed", "error", "cancelled"}:
        run.finished_at = _now()
    db.commit()
    db.refresh(run)
    logger.info(
        "imported CI run %s as execution run %s (status=%s, %s results)",
        ci_run_id,
        run.id,
        run.status,
        metrics.get("total", 0),
        extra={"run_id": run.id, "project_id": project_id},
    )
    return run
