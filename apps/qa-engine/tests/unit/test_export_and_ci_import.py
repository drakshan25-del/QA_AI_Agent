"""Regression tests for the export/metrics API (AC13) and CI import (AC9).

The export router is mounted on a throw-away FastAPI app with
``app.models.db.get_db`` overridden by an in-memory SQLite session — no file
database, network or LLM is touched (SRS §15.1, NFR-MNT-003). CI import is
exercised with ``tools.github_actions`` monkeypatched, so no GitHub API call
is ever made; the JUnit report comes from a fixture written to ``tmp_path``.

Covers: §18 item 13 / §10.2 machine-readable export with secret-key scrubbing
(SEC-002), §15.2 research metrics aggregation, and §18 item 9 CI-mode
ExecutionRun creation with FR-CI-002/003 + FR-RES-001 result import.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.ci_import as ci_import_module
import app.services.execution as execution_module
from app.api import export, git_ci
from app.models.db import Base, get_db
# Test* entity names are aliased so pytest does not try to collect them.
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
)
from app.models.entities import TestCase as TestCaseRow
from app.models.entities import TestPlan as TestPlanRow
from app.models.entities import TestResult as TestResultRow
from app.services.ci_import import import_ci_run
from tools import github_actions

pytestmark = pytest.mark.unit

_SECRET_KEY_PARTS = ("password", "token", "secret")

#: JUnit fixture: the two login tests resolve to test functions in a fixture
#: source file written under tmp_path by ``ci_stubs`` (with REPO_ROOT pointed
#: there), so the '# TC: TC-###' comment linker is exercised end-to-end
#: (FR-RES-001) without depending on the mutable real generated-tests tree;
#: 'test_invalid_password_login_failure' guards the TC-003 comment-format fix.
_JUNIT_XML = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="1" skipped="0" tests="3" time="4.2">
    <testcase classname="automation.generated_tests.test_login" name="test_successful_login" time="1.5"/>
    <testcase classname="automation.generated_tests.test_login" name="test_invalid_password_login_failure" time="1.2"/>
    <testcase classname="ci_suite" name="test_broken" time="1.5">
      <failure message="AssertionError: boom">traceback</failure>
    </testcase>
  </testsuite>
</testsuites>
"""


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
    """TestClient over the export + git/ci routers with get_db overridden."""

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    api = FastAPI(title="qa-agents-test-api")
    api.include_router(export.router)
    api.include_router(git_ci.router)
    api.dependency_overrides[get_db] = override_get_db
    return TestClient(api)


def _seed_project_graph(db) -> dict:
    """Seed one project with a full graph of related rows for export/metrics."""
    project = Project(name="export-project", base_url="http://localhost:8001")
    db.add(project)
    db.flush()

    requirement = Requirement(
        project_id=project.id,
        title="Login",
        text="Users must be able to log in.",
        acceptance_criteria=["Valid creds open the item list"],
        status="covered",
    )
    db.add(requirement)
    db.flush()

    analysis = Analysis(
        requirement_id=requirement.id,
        structured_output={"actors": ["user"]},
        risk={"score": 4},
    )
    plan = TestPlanRow(project_id=project.id, content={"objectives": ["prove login"]})
    gen_run_cases = GenerationRun(
        project_id=project.id,
        kind="test_cases",
        model="qwen2.5:latest",
        status="success",
        duration_seconds=2.0,
    )
    gen_run_analysis = GenerationRun(
        project_id=project.id,
        kind="analysis",
        model="qwen2.5:latest",
        status="success",
        duration_seconds=4.0,
    )
    db.add_all([analysis, plan, gen_run_cases, gen_run_analysis])
    db.flush()

    case = TestCaseRow(
        project_id=project.id,
        requirement_ids=[requirement.id],
        case_key="TC-001",
        title="Valid login",
        category="positive",
        review_status="approved",
        # Credential reference by env-var NAME (FR-PROJ-004); the export must
        # still scrub the 'password' key itself (SEC-002).
        test_data={"password": "QA_TEST_PASSWORD", "username": "QA_TEST_USERNAME"},
        generation_run_id=gen_run_cases.id,
    )
    db.add(case)
    db.flush()

    artifact = GeneratedArtifact(
        project_id=project.id,
        type="test_file",
        path="automation/generated_tests/test_login.py",
        content="def test_valid_login(page): ...",
        content_hash="a" * 64,
        test_case_ids=[case.id],
        approval_status="approved",
        validation_report={"passed": True, "issues": []},
    )
    exec_run = ExecutionRun(
        project_id=project.id,
        mode="local",
        status="completed",
        source_commit="abc1234",
        metrics={"passed": 1, "failed": 1, "api_token": "must-not-leak"},
    )
    db.add_all([artifact, exec_run])
    db.flush()

    result_pass = TestResultRow(
        execution_run_id=exec_run.id,
        test_case_id=case.id,
        node_id="automation/generated_tests/test_login.py::test_valid_login",
        outcome="passed",
        duration_seconds=1.5,
    )
    result_fail = TestResultRow(
        execution_run_id=exec_run.id,
        node_id="automation/generated_tests/test_login.py::test_incorrect_password_login",
        outcome="failed",
        error_message="AssertionError",
    )
    db.add_all([result_pass, result_fail])
    db.flush()

    finding = Finding(
        result_id=result_fail.id,
        classification="test_defect",
        ai_classification="app_defect",
        overridden_by="reviewer",  # human override (FR-RES-003)
        severity="medium",
    )
    approval = Approval(
        artefact_id=case.id, artefact_type="test_case", decision="approved"
    )
    audit = AuditEvent(
        actor="local-user",
        action="test_cases.generate",
        resource=f"project:{project.id}",
        event_metadata={"project_id": project.id},
    )
    db.add_all([finding, approval, audit])
    db.commit()
    return {
        "project_id": project.id,
        "requirement_id": requirement.id,
        "case_id": case.id,
        "artifact_id": artifact.id,
        "exec_run_id": exec_run.id,
    }


def _assert_no_secret_keys(value, path: str = "$") -> None:
    """Recursively assert no dict key contains password/token/secret (SEC-002)."""
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            assert not any(part in lowered for part in _SECRET_KEY_PARTS), (
                f"secret-looking key {key!r} leaked at {path}"
            )
            _assert_no_secret_keys(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_no_secret_keys(item, f"{path}[{index}]")


class TestExport:
    def test_export_contains_full_project_graph(self, client, session_factory):
        with session_factory() as db:
            seeded = _seed_project_graph(db)
        response = client.get(f"/projects/{seeded['project_id']}/export")
        assert response.status_code == 200, response.text
        body = response.json()

        assert body["project"]["id"] == seeded["project_id"]
        assert len(body["requirements"]) == 1
        assert len(body["analyses"]) == 1
        assert len(body["test_plans"]) == 1
        assert len(body["test_cases"]) == 1
        assert len(body["generation_runs"]) == 2
        assert len(body["execution_runs"]) == 1
        assert len(body["test_results"]) == 2
        assert len(body["findings"]) == 1
        assert len(body["approvals"]) == 1
        assert len(body["audit_events"]) == 1
        # Traceability survives the export (FR-TC-001, NFR-EXP-001).
        assert body["test_cases"][0]["requirement_ids"] == [seeded["requirement_id"]]
        assert body["execution_runs"][0]["source_commit"] == "abc1234"

    def test_export_artifacts_have_hashes_but_no_content(self, client, session_factory):
        with session_factory() as db:
            seeded = _seed_project_graph(db)
        body = client.get(f"/projects/{seeded['project_id']}/export").json()
        artifact = body["generated_artifacts"][0]
        assert "content" not in artifact  # §10.2: metadata only, never source
        assert artifact["content_hash"] == "a" * 64
        assert artifact["path"] == "automation/generated_tests/test_login.py"
        assert artifact["validation_passed"] is True
        assert artifact["approval_status"] == "approved"

    def test_export_emits_no_secret_keys(self, client, session_factory):
        with session_factory() as db:
            seeded = _seed_project_graph(db)
        body = client.get(f"/projects/{seeded['project_id']}/export").json()
        _assert_no_secret_keys(body)
        # The scrub dropped keys, not whole rows (SEC-002 without data loss).
        assert body["test_cases"][0]["test_data"] == {"username": "QA_TEST_USERNAME"}

    def test_export_unknown_project_404(self, client):
        assert client.get("/projects/missing/export").status_code == 404


class TestMetrics:
    def test_metrics_aggregation(self, client, session_factory):
        with session_factory() as db:
            seeded = _seed_project_graph(db)
        response = client.get(f"/projects/{seeded['project_id']}/metrics")
        assert response.status_code == 200, response.text
        body = response.json()

        # 1 requirement, covered by one approved case (FR-TC-006).
        assert body["requirements_coverage_pct"] == 100.0
        assert body["requirements_covered_by_approved_cases"] == 1
        assert body["cases_by_category"] == {"positive": 1}
        # 1 passed of 2 executed results.
        assert body["automation_execution_success_pct"] == 50.0
        assert body["findings_by_classification"] == {"test_defect": 1}
        assert body["overridden_classification_count"] == 1
        assert body["mean_generation_duration_seconds_by_kind"] == {
            "test_cases": 2.0,
            "analysis": 4.0,
        }
        assert len(body["per_run_pass_rates"]) == 1
        per_run = body["per_run_pass_rates"][0]
        assert per_run["execution_run_id"] == seeded["exec_run_id"]
        assert per_run["total"] == 2
        assert per_run["passed"] == 1
        assert per_run["pass_rate_pct"] == 50.0

    def test_metrics_empty_project(self, client, session_factory):
        with session_factory() as db:
            project = Project(name="empty-project")
            db.add(project)
            db.commit()
            project_id = project.id
        body = client.get(f"/projects/{project_id}/metrics").json()
        assert body["requirements_coverage_pct"] == 0.0
        assert body["cases_by_category"] == {}
        assert body["automation_execution_success_pct"] == 0.0
        assert body["per_run_pass_rates"] == []

    def test_metrics_unknown_project_404(self, client):
        assert client.get("/projects/missing/metrics").status_code == 404


@pytest.fixture()
def ci_stubs(monkeypatch, tmp_path):
    """Monkeypatch tools.github_actions + artifacts dir: no network, tmp files."""

    def fake_get_workflow_run(run_id: int) -> dict:
        return {
            "id": run_id,
            "status": "completed",
            "conclusion": "failure",  # tests ran, one failed
            "html_url": f"https://github.com/example/repo/actions/runs/{run_id}",
            "head_sha": "feedface" * 5,
        }

    def fake_list_run_artifacts(run_id: int) -> list[dict]:
        return [{"id": 7, "name": "test-results", "size_in_bytes": 123, "expired": False}]

    def fake_download_artifact(artifact_id: int, dest_dir) -> dict:
        dest = Path(dest_dir)
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "junit.xml").write_text(_JUNIT_XML, encoding="utf-8")
        return {"zip_path": str(dest / "a.zip"), "extracted_to": str(dest), "files": ["junit.xml"]}

    monkeypatch.setattr(github_actions, "get_workflow_run", fake_get_workflow_run)
    monkeypatch.setattr(github_actions, "list_run_artifacts", fake_list_run_artifacts)
    monkeypatch.setattr(github_actions, "download_artifact", fake_download_artifact)
    # Redirect artifact storage into tmp_path (no writes into the repo).
    monkeypatch.setattr(
        ci_import_module, "get_settings", lambda: SimpleNamespace(artifacts_path=tmp_path)
    )
    # Self-contained '# TC:' linking (FR-RES-001): the JUnit classnames resolve
    # against a fixture source tree under tmp_path, not the real (mutable)
    # automation/generated_tests directory.
    linked_src = tmp_path / "automation" / "generated_tests" / "test_login.py"
    linked_src.parent.mkdir(parents=True, exist_ok=True)
    # Functions are spaced further apart than the linker's ±8-line scan window
    # so each def only ever sees its own marker (as in real generated files).
    spacer = "\n" * 10
    linked_src.write_text(
        "# TC: TC-001\n"
        "def test_successful_login(page):\n"
        "    pass\n"
        f"{spacer}"
        "# TC: TC-003\n"
        "def test_invalid_password_login_failure(page):\n"
        "    pass\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(execution_module, "REPO_ROOT", tmp_path)
    return tmp_path


def _seed_ci_project(db) -> dict:
    """Project with TC-001/TC-003 so junit results link via '# TC:' markers."""
    project = Project(name="ci-project")
    db.add(project)
    db.flush()
    tc1 = TestCaseRow(project_id=project.id, case_key="TC-001", title="Valid login")
    tc3 = TestCaseRow(project_id=project.id, case_key="TC-003", title="Unknown username")
    db.add_all([tc1, tc3])
    db.commit()
    return {"project_id": project.id, "tc1_id": tc1.id, "tc3_id": tc3.id}


class TestCIImport:
    def test_import_creates_ci_run_and_results(self, session_factory, ci_stubs, tmp_path):
        with session_factory() as db:
            seeded = _seed_ci_project(db)
            run = import_ci_run(db, seeded["project_id"], 12345)

            # AC9: a CI-mode ExecutionRun linked to the workflow run.
            assert run.mode == "ci"
            assert run.environment == "ci"
            assert run.ci_run_id == "12345"
            assert run.ci_url.endswith("/actions/runs/12345")
            assert run.source_commit == "feedface" * 5  # AC11 provenance
            # conclusion 'failure' + parsed junit = ordinary failures (§17).
            assert run.status == "completed"
            assert run.finished_at is not None

            metrics = run.metrics
            assert metrics["passed"] == 2
            assert metrics["failed"] == 1
            assert metrics["total"] == 3
            assert metrics["artifacts_downloaded"] == 1
            assert metrics["ci_conclusion"] == "failure"

            # Artifacts landed under <artifacts>/ci/<ci_run_id>/ (FR-CI-003).
            assert (tmp_path / "ci" / "12345" / "junit.xml").is_file()

            results = list(
                db.scalars(
                    select(TestResultRow).where(TestResultRow.execution_run_id == run.id)
                ).all()
            )
            assert len(results) == 3
            by_name = {r.node_id.split("::")[-1]: r for r in results}
            # '# TC: TC-001' marker links the passed test (FR-RES-001).
            assert by_name["test_successful_login"].test_case_id == seeded["tc1_id"]
            # Regression: the fixed '# TC: TC-003' comment format now links.
            assert by_name["test_invalid_password_login_failure"].test_case_id == seeded["tc3_id"]
            assert by_name["test_broken"].test_case_id is None
            assert by_name["test_broken"].outcome == "failed"
            assert "AssertionError" in by_name["test_broken"].error_message

    def test_import_without_junit_degrades_gracefully(
        self, session_factory, ci_stubs, monkeypatch
    ):
        monkeypatch.setattr(github_actions, "list_run_artifacts", lambda run_id: [])
        monkeypatch.setattr(
            github_actions,
            "get_workflow_run",
            lambda run_id: {
                "id": run_id,
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://github.com/example/repo/actions/runs/99",
                "head_sha": "cafe" * 10,
            },
        )
        with session_factory() as db:
            seeded = _seed_ci_project(db)
            run = import_ci_run(db, seeded["project_id"], 99)
            assert run.status == "completed"
            assert run.metrics["artifacts_downloaded"] == 0
            assert any("no junit" in note for note in run.metrics["notes"])
            results = db.scalars(
                select(TestResultRow).where(TestResultRow.execution_run_id == run.id)
            ).all()
            assert list(results) == []

    def test_import_endpoint_records_audit_event(
        self, client, session_factory, ci_stubs
    ):
        with session_factory() as db:
            seeded = _seed_ci_project(db)
        response = client.post(
            f"/ci/runs/12345/import?project_id={seeded['project_id']}"
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["execution_run"]["mode"] == "ci"
        assert body["execution_run"]["ci_run_id"] == "12345"
        assert body["results_imported"] == 3
        assert body["source_commit"] == "feedface" * 5

        with session_factory() as db:
            runs = db.scalars(
                select(ExecutionRun).where(ExecutionRun.ci_run_id == "12345")
            ).all()
            assert len(runs) == 1
            # FR-AUD-001: the import is on the audit trail.
            actions = db.scalars(select(AuditEvent.action)).all()
            assert "ci.import" in actions

    def test_import_endpoint_unknown_project_404(self, client, ci_stubs):
        response = client.post("/ci/runs/12345/import?project_id=missing")
        assert response.status_code == 404
