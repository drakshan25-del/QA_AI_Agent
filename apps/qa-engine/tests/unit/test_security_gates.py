"""Regression tests for the security-audit fixes (SRS §13, SEC-005/006/011).

Covers:
    - SEC-EXEC-APPROVAL-BYPASS: POST /executions expands requested test paths
      to the actual ``.py`` files on disk — an untracked file under the
      generated-tests directory is refused with 403 even though no artifact
      row references it (FR-HITL-001, SEC-006).
    - SEC-EXEC-VALIDATION-GATE: an artifact whose validation report is missing
      or failing cannot be approved (409); rejection stays allowed and
      execution requires approval AND a passing report (FR-VAL-005, SEC-005).
    - SEC-DOMAIN-RUNTIME: the pure allow-list decision function used by the
      runtime Playwright route guard blocks disallowed hosts, allows listed
      hosts and subdomains, and falls back to the default list on empty/unset
      env — never allow-all (SEC-003).
    - SEC-UPLOAD-MEMORY: an oversize requirements upload is refused with 413
      via chunked reading (SEC-011).

Follows the in-memory-SQLite TestClient pattern of ``test_api_projects.py``:
real routers, ``get_db`` dependency-overridden, no network or LLM (SRS §15.1).
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import approvals, executions, projects, requirements
from app.models.db import Base, get_db
from app.models.entities import ExecutionRun, GeneratedArtifact
from automation.conftest import (
    DEFAULT_ALLOWED_DOMAINS,
    _allowed_domains,
    _api_request_guard,
    _host_allowed,
)
from tools.file_ingestion import MAX_FILE_SIZE_BYTES

pytestmark = pytest.mark.unit


@pytest.fixture()
def session_factory():
    """Shared in-memory SQLite engine (StaticPool: one DB across threads)."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    """TestClient over the real routers with get_db overridden."""

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    api = FastAPI(title="qa-agents-security-gates-test-api")
    api.include_router(projects.router)
    api.include_router(requirements.router)
    api.include_router(approvals.router)
    api.include_router(executions.router)
    api.dependency_overrides[get_db] = override_get_db
    return TestClient(api)


def _create_project(client: TestClient, name: str) -> dict:
    response = client.post(
        "/projects",
        json={"name": name, "base_url": "http://localhost:8001", "allowed_domains": "localhost"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _add_artifact(session_factory, project_id: str, **overrides) -> GeneratedArtifact:
    values = {
        "project_id": project_id,
        "type": "test_file",
        "path": "automation/generated_tests/test_login.py",
        "content": "def test_login(page): ...",
        **overrides,
    }
    with session_factory() as db:
        row = GeneratedArtifact(**values)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# SEC-EXEC-APPROVAL-BYPASS — files on disk drive the approval gate (SEC-006)
# ---------------------------------------------------------------------------


class TestExecutionApprovalGate:
    @pytest.fixture()
    def fake_repo(self, tmp_path, monkeypatch):
        """Point the executions router at a throw-away repo root so the gate
        inspects real files without touching the working tree."""
        generated = tmp_path / "automation" / "generated_tests"
        generated.mkdir(parents=True)
        (tmp_path / "automation" / "tests").mkdir(parents=True)
        settings_stub = SimpleNamespace(
            generated_tests_dir="automation/generated_tests",
            generated_tests_path=generated,
        )
        monkeypatch.setattr(executions, "BASE_DIR", tmp_path)
        monkeypatch.setattr(executions, "get_settings", lambda: settings_stub)
        return tmp_path

    @pytest.fixture()
    def fake_runner(self, monkeypatch):
        """Replace the pytest-subprocess runner with a DB-only stub."""

        def fake_start(db, project_id, request):
            run = ExecutionRun(project_id=project_id, status="completed", metrics={"passed": 1})
            db.add(run)
            db.commit()
            db.refresh(run)
            return run

        monkeypatch.setattr(executions, "start_local_execution", fake_start)

    def test_untracked_file_on_disk_refused(self, client, fake_repo):
        """A file pytest would collect but no artifact tracks -> 403 (SEC-006)."""
        project = _create_project(client, "exec-gate-untracked")
        evil = fake_repo / "automation" / "generated_tests" / "test_evil.py"
        evil.write_text("def test_evil():\n    assert True\n", encoding="utf-8")

        response = client.post(
            "/executions",
            json={"project_id": project["id"], "test_paths": ["automation/generated_tests"]},
        )
        assert response.status_code == 403, response.text
        assert "automation/generated_tests/test_evil.py" in response.json()["detail"]

    def test_direct_file_request_also_refused(self, client, fake_repo):
        """Requesting the untracked file itself (not a directory) -> 403."""
        project = _create_project(client, "exec-gate-direct")
        evil = fake_repo / "automation" / "generated_tests" / "test_evil.py"
        evil.write_text("def test_evil():\n    assert True\n", encoding="utf-8")

        response = client.post(
            "/executions",
            json={
                "project_id": project["id"],
                "test_paths": ["automation/generated_tests/test_evil.py"],
            },
        )
        assert response.status_code == 403

    def test_approved_but_failing_validation_refused(
        self, client, session_factory, fake_repo
    ):
        """Approval alone is not enough: the validation gate must have passed."""
        project = _create_project(client, "exec-gate-failing-report")
        path = fake_repo / "automation" / "generated_tests" / "test_login.py"
        path.write_text("def test_login():\n    assert True\n", encoding="utf-8")
        _add_artifact(
            session_factory,
            project["id"],
            approval_status="approved",
            validation_report={"passed": False, "issues": [{"check": "forbidden"}]},
        )

        response = client.post(
            "/executions",
            json={"project_id": project["id"], "test_paths": ["automation/generated_tests"]},
        )
        assert response.status_code == 403

    def test_approved_passing_file_executes(
        self, client, session_factory, fake_repo, fake_runner
    ):
        """Approved + passing report -> the gate lets the run start (201)."""
        project = _create_project(client, "exec-gate-approved")
        path = fake_repo / "automation" / "generated_tests" / "test_login.py"
        path.write_text("def test_login():\n    assert True\n", encoding="utf-8")
        _add_artifact(
            session_factory,
            project["id"],
            approval_status="approved",
            validation_report={"passed": True, "issues": []},
        )

        response = client.post(
            "/executions",
            json={"project_id": project["id"], "test_paths": ["automation/generated_tests"]},
        )
        assert response.status_code == 201, response.text
        assert response.json()["run"]["status"] == "completed"

    def test_human_written_tests_are_trusted(self, client, fake_repo, fake_runner):
        """Files outside the generated tree need no artifact approval."""
        project = _create_project(client, "exec-gate-trusted")
        smoke = fake_repo / "automation" / "tests" / "test_smoke.py"
        smoke.write_text("def test_smoke():\n    assert True\n", encoding="utf-8")

        response = client.post(
            "/executions",
            json={"project_id": project["id"], "test_paths": ["automation/tests"]},
        )
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# SEC-EXEC-VALIDATION-GATE — approval requires a passing report (SEC-005)
# ---------------------------------------------------------------------------


class TestApprovalValidationGate:
    def test_approve_refused_when_report_missing(self, client, session_factory):
        project = _create_project(client, "approve-no-report")
        artifact = _add_artifact(session_factory, project["id"])  # report defaults to {}

        response = client.post(
            f"/artifacts/{artifact.id}/approve",
            json={"decision": "approved", "actor": "reviewer"},
        )
        assert response.status_code == 409, response.text
        with session_factory() as db:
            assert db.get(GeneratedArtifact, artifact.id).approval_status == "draft"

    def test_approve_refused_when_report_failing(self, client, session_factory):
        project = _create_project(client, "approve-failing-report")
        artifact = _add_artifact(
            session_factory,
            project["id"],
            validation_report={"passed": False, "issues": [{"check": "secrets"}]},
        )

        response = client.post(
            f"/artifacts/{artifact.id}/approve",
            json={"decision": "approved", "actor": "reviewer"},
        )
        assert response.status_code == 409

    def test_rejection_still_allowed_without_passing_report(self, client, session_factory):
        project = _create_project(client, "reject-failing-report")
        artifact = _add_artifact(
            session_factory,
            project["id"],
            validation_report={"passed": False, "issues": []},
        )

        response = client.post(
            f"/artifacts/{artifact.id}/approve",
            json={"decision": "rejected", "actor": "reviewer", "comment": "unsafe"},
        )
        assert response.status_code == 200, response.text
        with session_factory() as db:
            assert db.get(GeneratedArtifact, artifact.id).approval_status == "rejected"

    def test_approve_allowed_with_passing_report(self, client, session_factory):
        project = _create_project(client, "approve-passing-report")
        artifact = _add_artifact(
            session_factory,
            project["id"],
            validation_report={"passed": True, "issues": []},
        )

        response = client.post(
            f"/artifacts/{artifact.id}/approve",
            json={"decision": "approved", "actor": "reviewer"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["artifact"]["approval_status"] == "approved"


# ---------------------------------------------------------------------------
# SEC-DOMAIN-RUNTIME — pure allow-list decision function (SEC-003)
# ---------------------------------------------------------------------------


class TestDomainAllowlist:
    def test_blocks_disallowed_host(self):
        assert _host_allowed("https://evil.com/exfiltrate", ["localhost", "127.0.0.1"]) is False

    def test_allows_listed_hosts_with_ports_and_paths(self):
        domains = ["localhost", "127.0.0.1"]
        assert _host_allowed("http://localhost:8001/login", domains) is True
        assert _host_allowed("http://127.0.0.1:8001/", domains) is True

    def test_allows_subdomain_via_dot_suffix(self):
        assert _host_allowed("https://app.example.com/page", ["example.com"]) is True
        assert _host_allowed("https://example.com/", ["example.com"]) is True

    def test_suffix_match_is_not_substring_match(self):
        assert _host_allowed("https://notexample.com/", ["example.com"]) is False
        assert _host_allowed("https://example.com.evil.com/", ["example.com"]) is False

    def test_unparseable_or_hostless_url_fails_closed(self):
        assert _host_allowed("not-a-url", ["localhost"]) is False
        assert _host_allowed("", ["localhost"]) is False

    def test_empty_or_unset_env_falls_back_to_default(self):
        default = DEFAULT_ALLOWED_DOMAINS.split(",")
        assert _allowed_domains(None) == default
        assert _allowed_domains("") == default
        assert _allowed_domains("  ,  ") == default
        # The fallback is a restrictive list, never allow-all.
        assert _host_allowed("https://evil.com/", _allowed_domains(None)) is False
        assert _host_allowed("http://localhost:8001/", _allowed_domains("")) is True

    def test_explicit_env_value_is_used(self):
        assert _allowed_domains("example.com, staging.example.org") == [
            "example.com",
            "staging.example.org",
        ]


class TestApiClientGuard:
    """The api_client fixture's request hook enforces SEC-003 for non-browser
    tests — the browser route guard cannot see httpx traffic."""

    @staticmethod
    def _client(domains: list[str]) -> httpx.Client:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json={"ok": True})
        )
        return httpx.Client(
            base_url="http://localhost:8001",
            transport=transport,
            event_hooks={"request": [_api_request_guard(domains)]},
        )

    def test_allowed_host_passes(self):
        with self._client(["localhost"]) as client:
            assert client.get("/api/health").status_code == 200

    def test_disallowed_host_refused_before_sending(self):
        with self._client(["localhost"]) as client:
            with pytest.raises(RuntimeError, match="non-allow-listed host"):
                client.get("https://evil.com/exfiltrate")

    def test_guard_fails_closed_on_empty_allowlist(self):
        with self._client([]) as client:
            with pytest.raises(RuntimeError, match="non-allow-listed host"):
                client.get("/api/health")


# ---------------------------------------------------------------------------
# SEC-UPLOAD-MEMORY — oversize upload refused with 413 (SEC-011)
# ---------------------------------------------------------------------------


class TestUploadSizeLimit:
    def test_oversize_upload_413(self, client):
        project = _create_project(client, "upload-oversize")
        oversize = b"a" * (MAX_FILE_SIZE_BYTES + 1)

        response = client.post(
            f"/projects/{project['id']}/requirements/upload",
            files={"file": ("big.txt", oversize, "text/plain")},
        )
        assert response.status_code == 413, response.text
        assert "limit" in response.json()["detail"]

    def test_small_upload_still_ingests(self, client):
        project = _create_project(client, "upload-small")
        response = client.post(
            f"/projects/{project['id']}/requirements/upload",
            files={"file": ("login.txt", b"Users must be able to log in.", "text/plain")},
        )
        assert response.status_code == 201, response.text
        assert len(response.json()) == 1
