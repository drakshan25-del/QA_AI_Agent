"""Pydantic schemas: API request/response bodies and agent structured outputs.

Agent output schemas are the contract between the LLM layer and the rest of
the system (FR-RA-001, FR-TP-001, FR-TC-002, FR-RES-002, FR-BUG-001).
Agents must produce these via structured output so downstream code never
parses free text.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# Projects / requirements (API)
# --------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    base_url: str = ""
    allowed_domains: str = "localhost,127.0.0.1"
    repository: str = ""
    environment: str = "test"
    llm_model: str = ""
    llm_temperature: float = 0.1


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    base_url: str | None = None
    allowed_domains: str | None = None
    repository: str | None = None
    environment: str | None = None
    status: str | None = None
    llm_model: str | None = None
    llm_temperature: float | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    base_url: str
    allowed_domains: str
    repository: str
    environment: str
    status: str
    llm_model: str
    llm_temperature: float
    created_at: datetime

    model_config = {"from_attributes": True}


class RequirementCreate(BaseModel):
    title: str = ""
    text: str
    acceptance_criteria: list[str] = Field(default_factory=list)
    source: str = "manual"


class RequirementOut(BaseModel):
    id: str
    project_id: str
    source: str
    version: int
    title: str
    text: str
    acceptance_criteria: list
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------------
# Requirement Analysis Agent output (FR-RA-001..004)
# --------------------------------------------------------------------------


class AmbiguityIssue(BaseModel):
    issue: str = Field(description="What is ambiguous, contradictory or missing")
    kind: str = Field(default="ambiguity", description="ambiguity|contradiction|missing_criteria")
    clarification_question: str = Field(default="", description="Question to ask the author")


class RiskAssessment(BaseModel):
    business_impact: str = Field(default="medium", description="low|medium|high")
    technical_complexity: str = Field(default="medium", description="low|medium|high")
    testability: str = Field(default="medium", description="low|medium|high")
    score: int = Field(default=5, ge=1, le=9, description="Overall risk 1 (low) - 9 (high)")
    rationale: str = ""


class RequirementAnalysisOutput(BaseModel):
    """Structured analysis of one requirement (FR-RA-001)."""

    requirement_id: str = ""
    actors: list[str] = Field(default_factory=list)
    preconditions: list[str] = Field(default_factory=list)
    triggers: list[str] = Field(default_factory=list)
    main_flow: list[str] = Field(default_factory=list)
    alternative_flows: list[str] = Field(default_factory=list)
    business_rules: list[str] = Field(default_factory=list)
    expected_outcomes: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(
        default_factory=list,
        description="Inferred content MUST be listed here, never silently invented (FR-RA-004)",
    )
    issues: list[AmbiguityIssue] = Field(default_factory=list)
    risk: RiskAssessment = Field(default_factory=RiskAssessment)


# --------------------------------------------------------------------------
# Test Plan Agent output (FR-TP-001..002)
# --------------------------------------------------------------------------


class TestPlanOutput(BaseModel):
    objectives: list[str] = Field(default_factory=list)
    scope: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    test_types: list[str] = Field(
        default_factory=list,
        description="Justified subset of: UI, API, integration, regression, smoke, security, accessibility",
    )
    environments: list[str] = Field(default_factory=list)
    test_data: list[str] = Field(default_factory=list)
    entry_criteria: list[str] = Field(default_factory=list)
    exit_criteria: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    deliverables: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Test Case Agent output (FR-TC-001..003)
# --------------------------------------------------------------------------


class TestCaseOutput(BaseModel):
    case_key: str = Field(default="", description="Stable key like TC-001")
    requirement_ids: list[str] = Field(
        default_factory=list, description="Traceability to requirement IDs (FR-TC-001)"
    )
    title: str
    objective: str = ""
    category: str = Field(
        default="positive",
        description="positive|negative|boundary|validation|role_based|error_handling|security",
    )
    priority: str = Field(default="medium", description="low|medium|high|critical")
    preconditions: list[str] = Field(default_factory=list)
    test_data: dict[str, str] = Field(default_factory=dict)
    steps: list[str] = Field(default_factory=list)
    expected_results: list[str] = Field(default_factory=list)
    automation_suitability: str = Field(
        default="automatable", description="automatable|manual_only|needs_review"
    )


class TestCasesOutput(BaseModel):
    test_cases: list[TestCaseOutput] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Automation Agent output (FR-AUT-001..007)
# --------------------------------------------------------------------------


class GeneratedFile(BaseModel):
    path: str = Field(description="Repo-relative path, e.g. automation/generated_tests/test_login.py")
    kind: str = Field(default="test_file", description="test_file|page_object|fixture")
    content: str
    test_case_ids: list[str] = Field(default_factory=list)


class AutomationOutput(BaseModel):
    files: list[GeneratedFile] = Field(default_factory=list)
    notes: str = ""


# --------------------------------------------------------------------------
# Validation gate (FR-VAL-001..005)
# --------------------------------------------------------------------------


class ValidationIssue(BaseModel):
    check: str  # syntax|imports|collection|forbidden|secrets|domains|locators|sleeps
    severity: str = "error"  # error|warning
    message: str
    location: str = ""


class ValidationReport(BaseModel):
    passed: bool
    issues: list[ValidationIssue] = Field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]


# --------------------------------------------------------------------------
# Execution / results (FR-EXE-004, FR-RES-001)
# --------------------------------------------------------------------------


class ExecutionRequest(BaseModel):
    project_id: str
    test_paths: list[str] = Field(default_factory=list)
    headed: bool = False
    browser: str = "chromium"
    environment: str = "local"
    markers: str = ""


class TestResultOut(BaseModel):
    id: str
    node_id: str
    outcome: str
    duration_seconds: float
    error_message: str
    evidence: dict

    model_config = {"from_attributes": True}


class ExecutionRunOut(BaseModel):
    id: str
    project_id: str
    mode: str
    status: str
    environment: str
    browser: str
    started_at: datetime | None
    finished_at: datetime | None
    metrics: dict
    ci_run_id: str
    ci_url: str

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------------
# Failure classification (FR-RES-002)
# --------------------------------------------------------------------------


class FailureClassificationOutput(BaseModel):
    classification: str = Field(
        description="app_defect|test_defect|environment|data|inconclusive"
    )
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    rationale: str = Field(description="Evidence-based explanation, not just a label (NFR-EXP-002)")
    severity: str = Field(default="medium", description="low|medium|high|critical")


# --------------------------------------------------------------------------
# Defect draft (FR-BUG-001)
# --------------------------------------------------------------------------


class DefectDraftOutput(BaseModel):
    title: str
    description: str
    environment: str = ""
    severity: str = "medium"
    priority: str = "medium"
    preconditions: list[str] = Field(default_factory=list)
    steps_to_reproduce: list[str] = Field(default_factory=list)
    expected_result: str = ""
    actual_result: str = ""
    evidence_refs: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Approvals / audit (FR-HITL, FR-AUD)
# --------------------------------------------------------------------------


class ApprovalRequest(BaseModel):
    decision: str = Field(description="approved|rejected|regenerate")
    actor: str = "local-user"
    comment: str = ""


class AuditEventOut(BaseModel):
    id: str
    actor: str
    action: str
    resource: str
    result: str
    correlation_id: str
    event_metadata: dict
    created_at: datetime

    model_config = {"from_attributes": True}
