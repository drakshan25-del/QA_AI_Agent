"""Git integration tools for the Agentic AI QA System (SRS FR-GIT-001..006).

All operations run as non-interactive subprocesses against the project
repository root. Credentials are supplied by the developer's default git
credential helper — this module never reads, stores, or prints tokens
(SEC-002, FR-CI-004). Destructive/remote actions (push) require an explicit
human approval flag (FR-GIT-006).
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Any

from app.core.config import BASE_DIR, get_settings
from app.core.logging import get_logger
from app.core.security import redact_secrets

logger = get_logger(__name__)

#: Repository root every git command runs in (FR-GIT-001).
REPO_ROOT = str(BASE_DIR)

#: Branches that generated code must never be committed to directly (FR-GIT-003).
PROTECTED_BRANCHES = frozenset({"main", "master"})

#: Allowed characters for a feature-branch suffix (FR-GIT-003).
_BRANCH_SUFFIX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

_GIT_TIMEOUT_SECONDS = 60


class GitCommandError(RuntimeError):
    """A git subprocess failed; message is secret-redacted (SEC-007)."""


def _run_git(
    args: list[str], *, check: bool = True, ok_returncodes: tuple[int, ...] = (0,)
) -> subprocess.CompletedProcess[str]:
    """Run a git command in the repo root, never interactively (FR-GIT-001).

    Args:
        args: Arguments after the ``git`` executable.
        check: Raise :class:`GitCommandError` on unexpected return codes.
        ok_returncodes: Return codes treated as success (``git diff`` uses 1).

    Returns:
        Completed process with captured, text-mode stdout/stderr.

    Raises:
        GitCommandError: When the command fails and ``check`` is True.
    """
    env = dict(os.environ)
    # Never prompt for credentials or editor input (SEC-002, non-interactive).
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_EDITOR"] = "true"
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            env=env,
            timeout=_GIT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:  # git binary missing
        raise GitCommandError("git executable not found on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise GitCommandError(
            f"git {' '.join(args[:2])} timed out after {_GIT_TIMEOUT_SECONDS}s"
        ) from exc
    if check and proc.returncode not in ok_returncodes:
        raise GitCommandError(
            f"git {' '.join(args[:2])} failed (exit {proc.returncode}): "
            + redact_secrets(proc.stderr.strip() or proc.stdout.strip())
        )
    return proc


def repo_status() -> dict[str, Any]:
    """Report repository state for the UI/orchestrator (FR-GIT-001).

    Returns:
        Dict with keys ``is_repo`` (bool), ``branch`` (str | None),
        ``dirty_files`` (list[str] of modified/untracked paths) and
        ``head_commit`` (str | None — None on an unborn branch).
    """
    inside = _run_git(["rev-parse", "--is-inside-work-tree"], check=False)
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return {"is_repo": False, "branch": None, "dirty_files": [], "head_commit": None}

    branch_proc = _run_git(["branch", "--show-current"], check=False)
    branch = branch_proc.stdout.strip() or None

    head_proc = _run_git(["rev-parse", "HEAD"], check=False)
    head_commit = head_proc.stdout.strip() if head_proc.returncode == 0 else None

    status_proc = _run_git(["status", "--porcelain"])
    dirty_files = [
        line[3:].strip() for line in status_proc.stdout.splitlines() if line.strip()
    ]
    return {
        "is_repo": True,
        "branch": branch,
        "dirty_files": dirty_files,
        "head_commit": head_commit,
    }


def diff_files(paths: list[str]) -> str:
    """Produce a unified diff for review, including untracked files (FR-GIT-002).

    Tracked paths are diffed against HEAD (or the index on an unborn branch);
    untracked paths are rendered as full-content additions via
    ``git diff --no-index`` so a reviewer sees exactly what would be committed.

    Args:
        paths: Repo-relative file paths to include.

    Returns:
        Unified diff text ('' when nothing differs).
    """
    if not paths:
        return ""
    has_head = _run_git(["rev-parse", "HEAD"], check=False).returncode == 0

    parts: list[str] = []
    base = ["diff", "HEAD", "--"] if has_head else ["diff", "--cached", "--"]
    tracked = _run_git([*base, *paths], ok_returncodes=(0, 1))
    if tracked.stdout.strip():
        parts.append(tracked.stdout)

    untracked_proc = _run_git(["ls-files", "--others", "--exclude-standard", "--", *paths])
    for path in untracked_proc.stdout.splitlines():
        path = path.strip()
        if not path:
            continue
        new_file = _run_git(
            ["diff", "--no-index", "--", os.devnull, path], ok_returncodes=(0, 1)
        )
        if new_file.stdout.strip():
            parts.append(new_file.stdout)
    return "".join(parts)


def create_feature_branch(name_suffix: str) -> str:
    """Create and switch to an AI feature branch (FR-GIT-003).

    The branch is named ``<settings.branch_prefix>/<name_suffix>`` so generated
    tests never land on a protected branch directly.

    Args:
        name_suffix: Short slug (letters, digits, ``.``, ``_``, ``-``);
            e.g. a run or requirement reference.

    Returns:
        The full branch name that is now checked out.

    Raises:
        ValueError: If the suffix contains invalid characters.
        GitCommandError: If git cannot create or switch to the branch.
    """
    name_suffix = name_suffix.strip()
    if not _BRANCH_SUFFIX_RE.match(name_suffix) or ".." in name_suffix:
        raise ValueError(
            "Invalid branch suffix "
            f"{name_suffix!r}: use only letters, digits, '.', '_' and '-' "
            "(must start with a letter or digit, no '..')."
        )
    branch = f"{get_settings().branch_prefix}/{name_suffix}"
    created = _run_git(["checkout", "-b", branch], check=False)
    if created.returncode != 0:
        # Branch may already exist — switching to it is idempotent and safe.
        _run_git(["checkout", branch])
    logger.info("Checked out feature branch %s", branch)
    return branch


def commit_files(paths: list[str], message: str) -> str:
    """Stage and commit the given paths on the current feature branch (FR-GIT-003/004).

    The commit message must be supplied by the caller and should reference the
    requirement, test-case, and generation-run IDs (FR-GIT-004). Committing is
    refused on protected branches ('main'/'master').

    Args:
        paths: Repo-relative file paths to stage.
        message: Full commit message provided by the caller.

    Returns:
        The new commit SHA.

    Raises:
        PermissionError: When the current branch is protected (FR-GIT-003).
        ValueError: When paths or message are empty.
        GitCommandError: On underlying git failures.
    """
    if not paths:
        raise ValueError("commit_files requires at least one path to stage.")
    if not message.strip():
        raise ValueError(
            "commit_files requires a caller-supplied message referencing the "
            "requirement/test-case/run (FR-GIT-004)."
        )
    branch = _run_git(["branch", "--show-current"], check=False).stdout.strip()
    if branch in PROTECTED_BRANCHES:
        raise PermissionError(
            f"Refusing to commit on protected branch {branch!r}; create a "
            f"'{get_settings().branch_prefix}/<suffix>' branch first (FR-GIT-003)."
        )
    _run_git(["add", "--", *paths])
    identity: list[str] = []
    if not _run_git(["config", "user.email"], check=False).stdout.strip():
        # Fallback identity so non-configured environments still commit;
        # no secrets involved (SEC-002).
        identity = [
            "-c", "user.name=AI QA Agent",
            "-c", "user.email=qa-agent@localhost",
        ]
    _run_git([*identity, "commit", "-m", message])
    sha = _run_git(["rev-parse", "HEAD"]).stdout.strip()
    logger.info("Committed %d file(s) on %s as %s", len(paths), branch, sha[:12])
    return sha


def push_branch(branch: str, approved: bool = False) -> dict[str, Any]:
    """Push a feature branch to ``origin`` after explicit approval (FR-GIT-006).

    Uses the developer's default git credentials via the credential helper;
    tokens are never read or printed by this function (SEC-002).

    Args:
        branch: Branch name to push (must not be protected).
        approved: Must be True — set only after a recorded human approval.

    Returns:
        Dict with ``branch``, ``remote`` and secret-redacted ``output``.

    Raises:
        PermissionError: If ``approved`` is False or the branch is protected.
        GitCommandError: On push failure (message secret-redacted).
    """
    if not approved:
        raise PermissionError(
            "push_branch requires explicit human approval (approved=True); "
            "record the approval before pushing (FR-GIT-006)."
        )
    if branch in PROTECTED_BRANCHES:
        raise PermissionError(
            f"Refusing to push protected branch {branch!r} (FR-GIT-003)."
        )
    proc = _run_git(["push", "--set-upstream", "origin", branch])
    output = redact_secrets((proc.stdout + proc.stderr).strip())
    logger.info("Pushed branch %s to origin", branch)
    return {"branch": branch, "remote": "origin", "pushed": True, "output": output}
