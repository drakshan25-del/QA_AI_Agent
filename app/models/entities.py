"""SQLAlchemy ORM entities implementing the data model of SRS §10.1."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    base_url: Mapped[str] = mapped_column(String(500), default="")
    allowed_domains: Mapped[str] = mapped_column(String(1000), default="localhost,127.0.0.1")
    repository: Mapped[str] = mapped_column(String(500), default="")
    environment: Mapped[str] = mapped_column(String(100), default="test")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|archived
    llm_model: Mapped[str] = mapped_column(String(100), default="")
    llm_temperature: Mapped[float] = mapped_column(Float, default=0.1)
    created_by: Mapped[str] = mapped_column(String(100), default="local-user")
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)

    requirements: Mapped[list["Requirement"]] = relationship(back_populates="project")

    @property
    def allowed_domain_list(self) -> list[str]:
        return [d.strip() for d in self.allowed_domains.split(",") if d.strip()]


class Requirement(Base):
    __tablename__ = "requirements"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    source: Mapped[str] = mapped_column(String(500), default="manual")  # manual|<filename>
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(300), default="")
    text: Mapped[str] = mapped_column(Text)
    acceptance_criteria: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="draft")  # draft|analysed|covered
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="requirements")
    analyses: Mapped[list["Analysis"]] = relationship(back_populates="requirement")


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    requirement_id: Mapped[str] = mapped_column(ForeignKey("requirements.id"))
    structured_output: Mapped[dict] = mapped_column(JSON, default=dict)
    assumptions: Mapped[list] = mapped_column(JSON, default=list)
    gaps: Mapped[list] = mapped_column(JSON, default=list)
    risk: Mapped[dict] = mapped_column(JSON, default=dict)
    model_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now)

    requirement: Mapped[Requirement] = relationship(back_populates="analyses")


class TestPlan(Base):
    __tablename__ = "test_plans"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    approval_status: Mapped[str] = mapped_column(String(20), default="draft")
    generation_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("generation_runs.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(default=_now)


class TestCase(Base):
    __tablename__ = "test_cases"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    requirement_ids: Mapped[list] = mapped_column(JSON, default=list)  # traceability FR-TC-001
    case_key: Mapped[str] = mapped_column(String(50), default="")  # e.g. TC-001
    title: Mapped[str] = mapped_column(String(300))
    objective: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(50), default="positive")
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    preconditions: Mapped[list] = mapped_column(JSON, default=list)
    test_data: Mapped[dict] = mapped_column(JSON, default=dict)
    steps: Mapped[list] = mapped_column(JSON, default=list)
    expected_results: Mapped[list] = mapped_column(JSON, default=list)
    automation_suitability: Mapped[str] = mapped_column(String(30), default="automatable")
    automation_status: Mapped[str] = mapped_column(String(30), default="not_automated")
    review_status: Mapped[str] = mapped_column(String(20), default="draft")  # draft|approved|rejected
    revision: Mapped[int] = mapped_column(Integer, default=1)
    generation_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("generation_runs.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class GenerationRun(Base):
    __tablename__ = "generation_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String(40))  # analysis|test_plan|test_cases|automation|...
    model: Mapped[str] = mapped_column(String(100), default="")
    prompt_version: Mapped[str] = mapped_column(String(50), default="v1")
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    output_hash: Mapped[str] = mapped_column(String(64), default="")
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|success|error
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=_now)


class GeneratedArtifact(Base):
    __tablename__ = "generated_artifacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    type: Mapped[str] = mapped_column(String(40))  # test_file|page_object|fixture|plan_export|...
    path: Mapped[str] = mapped_column(String(500))
    content: Mapped[str] = mapped_column(Text, default="")
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    test_case_ids: Mapped[list] = mapped_column(JSON, default=list)
    generation_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("generation_runs.id"), nullable=True
    )
    approval_status: Mapped[str] = mapped_column(String(20), default="draft")
    validation_report: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class ExecutionRun(Base):
    __tablename__ = "execution_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    mode: Mapped[str] = mapped_column(String(20), default="local")  # local|ci
    source_commit: Mapped[str] = mapped_column(String(64), default="")
    environment: Mapped[str] = mapped_column(String(100), default="local")
    browser: Mapped[str] = mapped_column(String(30), default="chromium")
    headed: Mapped[bool] = mapped_column(default=False)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)  # passed/failed/skipped/errors
    ci_run_id: Mapped[str] = mapped_column(String(64), default="")
    ci_url: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(default=_now)

    results: Mapped[list["TestResult"]] = relationship(back_populates="execution_run")


class TestResult(Base):
    __tablename__ = "test_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    execution_run_id: Mapped[str] = mapped_column(ForeignKey("execution_runs.id"))
    test_case_id: Mapped[str | None] = mapped_column(ForeignKey("test_cases.id"), nullable=True)
    node_id: Mapped[str] = mapped_column(String(500), default="")  # pytest nodeid
    outcome: Mapped[str] = mapped_column(String(20))  # passed|failed|skipped|error
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    error_message: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)  # screenshots/traces paths

    execution_run: Mapped[ExecutionRun] = relationship(back_populates="results")
    findings: Mapped[list["Finding"]] = relationship(back_populates="result")


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    result_id: Mapped[str] = mapped_column(ForeignKey("test_results.id"))
    classification: Mapped[str] = mapped_column(String(40))  # app_defect|test_defect|environment|data|inconclusive
    ai_classification: Mapped[str] = mapped_column(String(40), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    rationale: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(20), default="medium")
    overridden_by: Mapped[str] = mapped_column(String(100), default="")
    report_fields: Mapped[dict] = mapped_column(JSON, default=dict)  # defect draft FR-BUG-001
    external_issue_ref: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(default=_now)

    result: Mapped[TestResult] = relationship(back_populates="findings")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    artefact_id: Mapped[str] = mapped_column(String(32))  # id of artifact/plan/case being approved
    artefact_type: Mapped[str] = mapped_column(String(40))
    actor: Mapped[str] = mapped_column(String(100), default="local-user")
    decision: Mapped[str] = mapped_column(String(20))  # approved|rejected|regenerate
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100))
    resource: Mapped[str] = mapped_column(String(200), default="")
    result: Mapped[str] = mapped_column(String(20), default="success")
    correlation_id: Mapped[str] = mapped_column(String(32), default="")
    event_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now)
