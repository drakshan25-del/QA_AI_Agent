"""Unit tests for git/CI human-approval guards (FR-GIT-006, FR-CI-001, SEC-006).

Every test asserts the guard fires BEFORE any subprocess or network call:
``_run_git`` and the HTTP layer are stubbed to explode if reached
(SRS §15.1: offline unit tests, NFR-MNT-003).
"""

from __future__ import annotations

import pytest

from app.core.config import Settings
from tools import git_tools, github_actions
from tools.github_actions import GitHubNotConfiguredError

pytestmark = pytest.mark.unit


def _explode(*args, **kwargs):  # pragma: no cover - must never run
    raise AssertionError("guard failed: external command/network was invoked")


@pytest.fixture()
def no_git(monkeypatch):
    """Any git subprocess invocation fails the test."""
    monkeypatch.setattr(git_tools, "_run_git", _explode)


@pytest.fixture()
def no_http(monkeypatch):
    """Any GitHub HTTP request fails the test."""
    monkeypatch.setattr(github_actions, "_request", _explode)


def _settings(**overrides) -> Settings:
    """Fresh Settings isolated from any local .env file."""
    return Settings(_env_file=None, **overrides)


class TestGitApprovalGuards:
    def test_push_branch_requires_approval(self, no_git):
        # FR-GIT-006: push without a recorded human approval is refused.
        with pytest.raises(PermissionError, match="approval"):
            git_tools.push_branch("ai-tests/run-1", approved=False)

    def test_push_branch_default_is_unapproved(self, no_git):
        with pytest.raises(PermissionError):
            git_tools.push_branch("ai-tests/run-1")

    def test_push_protected_branch_refused_even_when_approved(self, no_git):
        # FR-GIT-003: main/master are never pushed by the agent.
        with pytest.raises(PermissionError, match="protected"):
            git_tools.push_branch("main", approved=True)
        with pytest.raises(PermissionError, match="protected"):
            git_tools.push_branch("master", approved=True)

    def test_invalid_branch_suffix_rejected(self, no_git):
        with pytest.raises(ValueError, match="suffix"):
            git_tools.create_feature_branch("bad name with spaces!")

    def test_commit_requires_paths_and_message(self, no_git):
        with pytest.raises(ValueError):
            git_tools.commit_files([], "message")
        with pytest.raises(ValueError, match="FR-GIT-004"):
            git_tools.commit_files(["automation/generated_tests/test_x.py"], "   ")


class TestCIApprovalGuards:
    def test_dispatch_workflow_requires_approval(self, no_http):
        # FR-CI-001 / SEC-006: CI dispatch needs approved=True.
        with pytest.raises(PermissionError, match="approval"):
            github_actions.dispatch_workflow(ref="ai-tests/run-1", approved=False)

    def test_dispatch_workflow_default_is_unapproved(self, no_http):
        with pytest.raises(PermissionError):
            github_actions.dispatch_workflow()

    def test_rerun_failed_jobs_requires_approval(self, no_http):
        with pytest.raises(PermissionError, match="approval"):
            github_actions.rerun_failed_jobs(run_id=123, approved=False)


class TestGitHubConfigurationGuards:
    def test_missing_token_raises_not_configured(self, monkeypatch):
        # FR-CI-004 / SEC-002: token comes from GITHUB_TOKEN env only.
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setattr(
            github_actions, "get_settings", lambda: _settings(github_repo="owner/name")
        )
        with pytest.raises(GitHubNotConfiguredError, match="GITHUB_TOKEN"):
            github_actions.dispatch_workflow(approved=True)

    def test_missing_repo_raises_not_configured(self, monkeypatch):
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setattr(github_actions, "get_settings", lambda: _settings(github_repo=""))
        with pytest.raises(GitHubNotConfiguredError, match="github_repo"):
            github_actions.get_workflow_run(run_id=1)

    def test_error_message_never_contains_a_token_value(self, monkeypatch):
        fake_token = "ghp_" + "x" * 24
        monkeypatch.setenv("GITHUB_TOKEN", fake_token)
        monkeypatch.setattr(github_actions, "get_settings", lambda: _settings(github_repo=""))
        # Repo missing fires first; whatever is raised must not leak the token.
        with pytest.raises(GitHubNotConfiguredError) as excinfo:
            github_actions.list_run_artifacts(run_id=1)
        assert fake_token not in str(excinfo.value)
