"""Unit tests for the project / requirement / approval API (SRS §14.2).

The real routers are mounted on a throw-away FastAPI app and
``app.models.db.get_db`` is dependency-overridden with an in-memory SQLite
session, so no file database, network or LLM is touched (SRS §15.1,
NFR-MNT-003). Covers FR-PROJ-001..003, FR-IN-005/006 over HTTP, and
FR-HITL-001/003 (approval decisions persist an Approval row).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import approvals, projects, requirements
from app.models.db import Base, get_db
from app.models.entities import Approval, AuditEvent, GeneratedArtifact, Project

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

    api = FastAPI(title="qa-agents-test-api")
    api.include_router(projects.router)
    api.include_router(requirements.router)
    api.include_router(approvals.router)
    api.dependency_overrides[get_db] = override_get_db
    return TestClient(api)


def _create_project(client: TestClient, name: str = "web-shop") -> dict:
    response = client.post(
        "/projects",
        json={"name": name, "base_url": "http://localhost:8001", "allowed_domains": "localhost"},
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestProjects:
    def test_create_project(self, client):
        body = _create_project(client)
        assert body["id"]
        assert body["name"] == "web-shop"
        assert body["status"] == "active"

    def test_duplicate_name_conflict(self, client):
        _create_project(client, "dup")
        response = client.post(
            "/projects", json={"name": "dup", "allowed_domains": "localhost"}
        )
        assert response.status_code == 409

    def test_invalid_base_url_rejected(self, client):
        response = client.post(
            "/projects",
            json={"name": "bad-url", "base_url": "not-a-url", "allowed_domains": "localhost"},
        )
        assert response.status_code == 400
        assert "FR-PROJ-002" in response.json()["detail"]

    def test_empty_allowlist_rejected(self, client):
        response = client.post(
            "/projects", json={"name": "no-domains", "allowed_domains": "  , "}
        )
        assert response.status_code == 400
        assert "FR-PROJ-003" in response.json()["detail"]

    def test_list_projects(self, client):
        _create_project(client, "p-one")
        _create_project(client, "p-two")
        response = client.get("/projects")
        assert response.status_code == 200
        names = {p["name"] for p in response.json()}
        assert {"p-one", "p-two"} <= names

    def test_get_project(self, client):
        created = _create_project(client)
        response = client.get(f"/projects/{created['id']}")
        assert response.status_code == 200
        assert response.json()["name"] == "web-shop"

    def test_get_unknown_project_404(self, client):
        assert client.get("/projects/does-not-exist").status_code == 404

    def test_archive_project(self, client, session_factory):
        created = _create_project(client)
        response = client.patch(f"/projects/{created['id']}", json={"status": "archived"})
        assert response.status_code == 200
        assert response.json()["status"] == "archived"
        with session_factory() as db:
            assert db.get(Project, created["id"]).status == "archived"
            # FR-AUD-001: the archive decision is on the audit trail.
            actions = db.scalars(select(AuditEvent.action)).all()
            assert "project.archive" in actions

    def test_archive_invalid_status_rejected(self, client):
        created = _create_project(client)
        response = client.patch(f"/projects/{created['id']}", json={"status": "deleted"})
        assert response.status_code == 400


class TestRequirements:
    def test_create_requirement(self, client):
        project = _create_project(client)
        response = client.post(
            f"/projects/{project['id']}/requirements",
            json={
                "title": "Login",
                "text": "Users must be able to log in.",
                "acceptance_criteria": ["Valid creds open the item list"],
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["version"] == 1
        assert body["source"] == "manual"
        assert body["acceptance_criteria"] == ["Valid creds open the item list"]

    def test_duplicate_requirement_conflict(self, client):
        project = _create_project(client)
        payload = {"title": "Login", "text": "Users must be able to log in."}
        first = client.post(f"/projects/{project['id']}/requirements", json=payload)
        assert first.status_code == 201
        # FR-IN-005: identical text in the same project -> 409.
        second = client.post(f"/projects/{project['id']}/requirements", json=payload)
        assert second.status_code == 409

    def test_new_text_same_title_bumps_version(self, client):
        project = _create_project(client)
        client.post(
            f"/projects/{project['id']}/requirements",
            json={"title": "Login", "text": "Users must log in."},
        )
        response = client.post(
            f"/projects/{project['id']}/requirements",
            json={"title": "Login", "text": "Users must log in with MFA."},
        )
        # FR-IN-006: same title + source, changed text -> version 2.
        assert response.json()["version"] == 2

    def test_requirement_for_unknown_project_404(self, client):
        response = client.post(
            "/projects/nope/requirements", json={"title": "X", "text": "Some text."}
        )
        assert response.status_code == 404

    def test_list_requirements(self, client):
        project = _create_project(client)
        client.post(
            f"/projects/{project['id']}/requirements",
            json={"title": "Login", "text": "Users must log in."},
        )
        response = client.get(f"/projects/{project['id']}/requirements")
        assert response.status_code == 200
        assert [r["title"] for r in response.json()] == ["Login"]


class TestApprovals:
    @pytest.fixture()
    def artifact(self, client, session_factory):
        project = _create_project(client, "approval-project")
        with session_factory() as db:
            row = GeneratedArtifact(
                project_id=project["id"],
                type="test_file",
                path="automation/generated_tests/test_login.py",
                content="def test_login(page): ...",
                # Approval requires a passing validation report (FR-VAL-005 /
                # SEC-005); the gate itself is covered in test_security_gates.py.
                validation_report={"passed": True, "issues": []},
            )
            db.add(row)
            db.commit()
            db.refresh(row)
        return row

    def test_approval_stores_approval_row(self, client, session_factory, artifact):
        response = client.post(
            f"/artifacts/{artifact.id}/approve",
            json={"decision": "approved", "actor": "reviewer", "comment": "looks safe"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["artifact"]["approval_status"] == "approved"
        assert body["approval"]["decision"] == "approved"

        # FR-HITL-003: the decision is persisted as an Approval row.
        with session_factory() as db:
            rows = db.scalars(
                select(Approval).where(Approval.artefact_id == artifact.id)
            ).all()
            assert len(rows) == 1
            assert rows[0].decision == "approved"
            assert rows[0].actor == "reviewer"
            assert rows[0].comment == "looks safe"
            assert rows[0].artefact_type == "generated_artifact"

    def test_rejection_blocks_artifact(self, client, session_factory, artifact):
        response = client.post(
            f"/artifacts/{artifact.id}/approve",
            json={"decision": "rejected", "actor": "reviewer", "comment": "unsafe locator"},
        )
        assert response.status_code == 200
        with session_factory() as db:
            assert db.get(GeneratedArtifact, artifact.id).approval_status == "rejected"

    def test_invalid_decision_rejected(self, client, artifact):
        response = client.post(
            f"/artifacts/{artifact.id}/approve", json={"decision": "maybe"}
        )
        assert response.status_code == 400

    def test_unknown_artifact_404(self, client):
        response = client.post(
            "/artifacts/missing/approve", json={"decision": "approved"}
        )
        assert response.status_code == 404
