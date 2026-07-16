"""GitHub Actions integration over the REST API (SRS FR-CI-001..005, §12).

The token is read from the ``GITHUB_TOKEN`` environment variable only and is
never stored, logged, or included in error messages (SEC-002, FR-CI-004).
Workflow-triggering actions require an explicit ``approved`` flag set after a
recorded human approval (SEC-006).
"""

from __future__ import annotations

import os
import zipfile
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import redact_secrets

logger = get_logger(__name__)

GITHUB_API = "https://api.github.com"
_API_VERSION = "2022-11-28"
_TIMEOUT_SECONDS = 30.0


class GitHubNotConfiguredError(RuntimeError):
    """GitHub integration is not configured; message explains how to fix it."""


class GitHubAPIError(RuntimeError):
    """A GitHub API call failed; message is secret-redacted (SEC-002)."""


def _get_token() -> str:
    """Return the API token from the environment only (SEC-002, FR-CI-004)."""
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        raise GitHubNotConfiguredError(
            "GITHUB_TOKEN is not set. Export a GitHub token with 'repo' and "
            "'actions' scopes in your shell (e.g. `export GITHUB_TOKEN=...`) "
            "before using CI features. The token is never stored or logged."
        )
    return token


def _get_repo() -> str:
    """Return the 'owner/name' repository slug from settings (FR-CI-001)."""
    repo = get_settings().github_repo.strip()
    if not repo or "/" not in repo:
        raise GitHubNotConfiguredError(
            "github_repo is not configured. Set QA_GITHUB_REPO='owner/name' "
            "in your environment or .env file to enable GitHub Actions "
            "integration."
        )
    return repo


def _headers() -> dict[str, str]:
    """Build auth headers. Never log or echo these (SEC-002)."""
    return {
        "Authorization": f"Bearer {_get_token()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": _API_VERSION,
    }


def _request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    follow_redirects: bool = False,
) -> httpx.Response:
    """Perform one authenticated GitHub API call with redacted error paths.

    Args:
        method: HTTP verb.
        path: Path under the API host, e.g. ``/repos/{repo}/actions/...``.
        json: Optional JSON body.
        follow_redirects: Needed for artifact zip downloads (FR-CI-003).

    Returns:
        The successful response.

    Raises:
        GitHubNotConfiguredError: When token/repo are missing.
        GitHubAPIError: On HTTP or network failure — headers are never
            included in the raised message (SEC-002).
    """
    url = f"{GITHUB_API}{path}"
    try:
        with httpx.Client(timeout=_TIMEOUT_SECONDS, follow_redirects=follow_redirects) as client:
            response = client.request(method, url, headers=_headers(), json=json)
            response.raise_for_status()
            return response
    except httpx.HTTPStatusError as exc:
        # Build the message ourselves: only status + redacted body, never headers.
        body = redact_secrets(exc.response.text[:500])
        raise GitHubAPIError(
            f"GitHub API {method} {path} failed with HTTP "
            f"{exc.response.status_code}: {body}"
        ) from None
    except httpx.HTTPError as exc:
        raise GitHubAPIError(
            f"GitHub API {method} {path} failed: {redact_secrets(str(exc))}"
        ) from None


def dispatch_workflow(
    workflow_file: str = "playwright-ci.yml",
    ref: str = "main",
    approved: bool = False,
) -> dict[str, Any]:
    """Trigger a workflow_dispatch run of the CI pipeline (FR-CI-001).

    Args:
        workflow_file: Workflow file name under ``.github/workflows/``.
        ref: Branch or tag to run against.
        approved: Must be True — set only after a recorded human approval
            (SEC-006).

    Returns:
        Dict with ``dispatched``, ``workflow_file``, ``ref`` and ``repo``.

    Raises:
        PermissionError: If ``approved`` is False.
        GitHubNotConfiguredError: If token or repo are missing.
        GitHubAPIError: On API failure.
    """
    if not approved:
        raise PermissionError(
            "dispatch_workflow requires explicit human approval "
            "(approved=True) before triggering CI (FR-CI-001, SEC-006)."
        )
    repo = _get_repo()
    _request(
        "POST",
        f"/repos/{repo}/actions/workflows/{workflow_file}/dispatches",
        json={"ref": ref},
    )
    logger.info("Dispatched workflow %s on %s@%s", workflow_file, repo, ref)
    return {"dispatched": True, "workflow_file": workflow_file, "ref": ref, "repo": repo}


def get_workflow_run(run_id: int) -> dict[str, Any]:
    """Fetch and normalize the status of a workflow run (FR-CI-002).

    Args:
        run_id: GitHub Actions run identifier.

    Returns:
        Dict with ``id``, ``status`` (queued | in_progress | completed),
        ``conclusion`` (success/failure/... or None while running),
        ``html_url`` and ``head_sha``.
    """
    repo = _get_repo()
    data = _request("GET", f"/repos/{repo}/actions/runs/{run_id}").json()
    return {
        "id": data.get("id"),
        "status": data.get("status"),
        "conclusion": data.get("conclusion"),
        "html_url": data.get("html_url"),
        "head_sha": data.get("head_sha"),
    }


def list_run_artifacts(run_id: int) -> list[dict[str, Any]]:
    """List downloadable artifacts produced by a run (FR-CI-003).

    Args:
        run_id: GitHub Actions run identifier.

    Returns:
        List of dicts with ``id``, ``name``, ``size_in_bytes`` and ``expired``.
    """
    repo = _get_repo()
    data = _request("GET", f"/repos/{repo}/actions/runs/{run_id}/artifacts").json()
    return [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "size_in_bytes": item.get("size_in_bytes"),
            "expired": item.get("expired"),
        }
        for item in data.get("artifacts", [])
    ]


def download_artifact(artifact_id: int, dest_dir: str | Path) -> dict[str, Any]:
    """Download a run artifact zip and extract it locally (FR-CI-003).

    Args:
        artifact_id: Artifact identifier from :func:`list_run_artifacts`.
        dest_dir: Directory to place the zip and its extracted contents in
            (created if missing).

    Returns:
        Dict with ``zip_path``, ``extracted_to`` and ``files`` (extracted
        member names).

    Raises:
        GitHubAPIError: On download failure.
        zipfile.BadZipFile: If the downloaded payload is not a valid zip.
    """
    repo = _get_repo()
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    response = _request(
        "GET",
        f"/repos/{repo}/actions/artifacts/{artifact_id}/zip",
        follow_redirects=True,
    )
    zip_path = dest / f"artifact_{artifact_id}.zip"
    zip_path.write_bytes(response.content)
    with zipfile.ZipFile(zip_path) as archive:
        # Guard against path traversal in archive member names.
        members = [m for m in archive.namelist() if not (m.startswith("/") or ".." in m)]
        archive.extractall(dest, members=members)
    logger.info("Downloaded artifact %s to %s (%d files)", artifact_id, dest, len(members))
    return {"zip_path": str(zip_path), "extracted_to": str(dest), "files": members}


def rerun_failed_jobs(run_id: int, approved: bool = False) -> dict[str, Any]:
    """Re-run only the failed jobs of a workflow run (FR-CI-005).

    Args:
        run_id: GitHub Actions run identifier.
        approved: Must be True — set only after a recorded human approval
            (SEC-006).

    Returns:
        Dict with ``rerun_requested`` and ``run_id``.

    Raises:
        PermissionError: If ``approved`` is False.
        GitHubAPIError: On API failure.
    """
    if not approved:
        raise PermissionError(
            "rerun_failed_jobs requires explicit human approval "
            "(approved=True) before re-triggering CI (FR-CI-005, SEC-006)."
        )
    repo = _get_repo()
    _request("POST", f"/repos/{repo}/actions/runs/{run_id}/rerun-failed-jobs")
    logger.info("Requested rerun of failed jobs for run %s on %s", run_id, repo)
    return {"rerun_requested": True, "run_id": run_id, "repo": repo}
