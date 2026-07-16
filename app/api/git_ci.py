"""Git and CI endpoints (SRS FR-GIT-001..006, FR-CI-001..005, SEC-006).

POST /git/commit is a two-phase, human-gated flow: with ``approved=false`` it
returns the unified diff for review (dry-run preview, FR-GIT-002); with
``approved=true`` it creates the ``<branch_prefix>/<suffix>`` feature branch
and commits (FR-GIT-003/004). Only artifacts that passed the validation gate
AND carry a recorded approval may be committed (SEC-005, FR-HITL-001).
CI dispatch equally requires the explicit approved flag (FR-CI-001, SEC-006);
tokens are read from the environment inside ``tools.github_actions`` and
never pass through this layer (FR-CI-004). Every mutation records an audit
event (FR-AUD-001).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import new_correlation_id
from app.models.db import get_db
from app.models.entities import ExecutionRun, GeneratedArtifact
from app.services.audit import record_event
from tools.git_tools import (
    GitCommandError,
    commit_files,
    create_feature_branch,
    diff_files,
    repo_status,
)
from tools.github_actions import (
    GitHubAPIError,
    GitHubNotConfiguredError,
    dispatch_workflow,
    get_workflow_run,
)

router = APIRouter(tags=["git-ci"])


class GitCommitRequest(BaseModel):
    """Body of POST /git/commit (FR-GIT-002/003/004/006)."""

    paths: list[str] = Field(min_length=1, description="Repo-relative paths to commit")
    message: str = Field(default="", description="Commit message citing REQ/TC/run ids (FR-GIT-004)")
    branch_suffix: str = Field(default="", description="Suffix for the ai-tests/<suffix> branch")
    approved: bool = Field(
        default=False,
        description="False = dry-run diff preview; True = branch + commit (FR-GIT-006)",
    )
    actor: str = "local-user"


class CIDispatchRequest(BaseModel):
    """Body of POST /ci/dispatch (FR-CI-001, SEC-006)."""

    workflow_file: str = "playwright-ci.yml"
    ref: str = ""
    approved: bool = False
    actor: str = "local-user"


def _guard_committable(db: Session, paths: list[str]) -> None:
    """Every path must be a validated AND approved generated artifact.

    Enforces SEC-005 (validation gate before commit) and FR-HITL-001 /
    FR-GIT-006 (no unapproved or rejected artifact reaches the repository).
    """
    problems: list[str] = []
    for path in paths:
        artifact = db.scalars(
            select(GeneratedArtifact)
            .where(GeneratedArtifact.path == path)
            .order_by(GeneratedArtifact.created_at.desc())
        ).first()
        if artifact is None:
            problems.append(f"{path}: not a tracked generated artifact")
        elif artifact.approval_status != "approved":
            problems.append(f"{path}: approval_status={artifact.approval_status!r}")
        elif not (artifact.validation_report or {}).get("passed", False):
            problems.append(f"{path}: validation gate not passed (SEC-005)")
    if problems:
        raise HTTPException(
            status_code=403,
            detail="Commit refused (FR-GIT-006/FR-HITL-001): " + "; ".join(problems),
        )


@router.post("/git/commit")
def git_commit(body: GitCommitRequest, db: Session = Depends(get_db)) -> dict:
    """Preview (approved=false) or perform (approved=true) a commit."""
    _guard_committable(db, body.paths)

    if not body.approved:
        # Dry-run preview: show exactly what would be committed (FR-GIT-002).
        try:
            diff = diff_files(body.paths)
        except GitCommandError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from None
        record_event(
            db,
            actor=body.actor,
            action="git.diff_preview",
            resource="git",
            correlation_id=new_correlation_id(),
            paths=body.paths,
        )
        return {
            "committed": False,
            "diff": diff,
            "repo": repo_status(),
            "hint": "Review the diff, then repeat with approved=true, a "
            "branch_suffix and a message to commit (FR-GIT-006).",
        }

    if not body.branch_suffix.strip():
        raise HTTPException(
            status_code=400,
            detail="branch_suffix is required when approved=true (FR-GIT-003).",
        )
    if not body.message.strip():
        raise HTTPException(
            status_code=400,
            detail="message is required when approved=true and should reference "
            "requirement/test-case/run ids (FR-GIT-004).",
        )
    try:
        branch = create_feature_branch(body.branch_suffix)
        sha = commit_files(body.paths, body.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except GitCommandError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    record_event(
        db,
        actor=body.actor,
        action="git.commit",
        resource=f"git:{branch}",
        correlation_id=new_correlation_id(),
        paths=body.paths,
        branch=branch,
        commit_sha=sha,
    )
    return {"committed": True, "branch": branch, "commit_sha": sha, "paths": body.paths}


@router.post("/ci/dispatch", status_code=202)
def ci_dispatch(body: CIDispatchRequest, db: Session = Depends(get_db)) -> dict:
    """Trigger the CI workflow after explicit approval (FR-CI-001, SEC-006)."""
    ref = body.ref.strip() or get_settings().github_default_branch
    try:
        result = dispatch_workflow(
            workflow_file=body.workflow_file, ref=ref, approved=body.approved
        )
    except PermissionError as exc:
        record_event(
            db,
            actor=body.actor,
            action="ci.dispatch",
            resource=f"ci:{body.workflow_file}",
            result="denied",
            correlation_id=new_correlation_id(),
            ref=ref,
        )
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except GitHubNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except GitHubAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    record_event(
        db,
        actor=body.actor,
        action="ci.dispatch",
        resource=f"ci:{body.workflow_file}",
        correlation_id=new_correlation_id(),
        ref=ref,
        repo=result.get("repo", ""),
    )
    return result


@router.get("/ci/runs/{run_id}")
def ci_run_status(run_id: int, db: Session = Depends(get_db)) -> dict:
    """Fetch CI run status and sync it onto a linked ExecutionRun (FR-CI-002)."""
    try:
        status = get_workflow_run(run_id)
    except GitHubNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except GitHubAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    linked = db.scalars(
        select(ExecutionRun)
        .where(ExecutionRun.ci_run_id == str(run_id))
        .order_by(ExecutionRun.created_at.desc())
    ).first()
    if linked is not None:
        linked.ci_url = status.get("html_url") or linked.ci_url
        metrics = dict(linked.metrics or {})
        metrics["ci_status"] = status.get("status")
        metrics["ci_conclusion"] = status.get("conclusion")
        linked.metrics = metrics
        if status.get("status") == "in_progress":
            linked.status = "running"
        elif status.get("status") == "completed":
            linked.status = "completed" if status.get("conclusion") == "success" else "error"
        db.commit()
        status["execution_run_id"] = linked.id
    return status
