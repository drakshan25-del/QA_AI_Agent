"""Engine-specific versioned schemas (FR-ENG-005).

The agent output schemas (RequirementAnalysisOutput, TestPlanOutput,
TestCasesOutput, AutomationOutput, ValidationReport,
FailureClassificationOutput, DefectDraftOutput) are reused unchanged from
``app.models.schemas`` — the engine wraps the existing V1 logic, so those
contracts stay the single definition. This module adds the schemas that are
new in V2: document parsing with source-location metadata (FR-IN-002/008),
the execution plan (FR-AUT-011) and the live execution event (FR-EXE-006).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

#: Bumped when any engine output schema changes (backend pins this).
SCHEMA_VERSION = "v1"


class EngineError(BaseModel):
    code: str
    message: str
    correlation_id: str = ""


# --- Document parsing (FR-IN-002/003/008) ---------------------------------


class ParsedSegment(BaseModel):
    """One traceable slice of a source document (FR-IN-003/008)."""

    page_or_sheet: str = Field(description="Page number, sheet name, or '' ")
    row_or_section: str = Field(description="Row number, heading, paragraph or cell range")
    content: str
    metadata: dict = Field(default_factory=dict)
    inclusion_status: str = Field(default="included", description="included|excluded")


class ParsedDocument(BaseModel):
    filename: str
    category: str = Field(description="user_story|epic|srs|api_doc|architecture")
    kind: str = Field(description="text|markdown|json|pdf|docx|xlsx")
    text: str = ""
    segments: list[ParsedSegment] = Field(default_factory=list)
    parse_status: str = Field(default="parsed", description="parsed|empty|scanned|error")
    message: str = ""
    metadata: dict = Field(default_factory=dict)


class DocumentParseResult(ParsedDocument):
    """Alias kept for clarity in the /parse response list."""


class ParseResponse(BaseModel):
    schema_version: str = SCHEMA_VERSION
    documents: list[ParsedDocument] = Field(default_factory=list)


# --- Execution plan (FR-AUT-011) ------------------------------------------


class ExecutionPlanStep(BaseModel):
    sequence: int
    action_type: str = Field(description="navigate|click|fill|select|upload|wait|assert|screenshot")
    target: str = ""
    description: str = ""
    expected: str = ""


class ExecutionPlan(BaseModel):
    test_case_id: str
    case_key: str = ""
    title: str = ""
    steps: list[ExecutionPlanStep] = Field(default_factory=list)


# --- Execution events + results (FR-EXE-006/004) --------------------------


class ExecutionEventModel(BaseModel):
    """One ordered live execution event (FR-EXE-006/007/008)."""

    run_id: str
    test_case_id: str = ""
    test_name: str = ""
    sequence: int
    action_type: str
    target: str = ""
    value_summary: str = Field(default="", description="redacted (SEC-007)")
    status: str = Field(description="running|passed|failed|skipped")
    current_url: str = ""
    elapsed_ms: int = 0
    ts: str = ""
    evidence_uri: str = ""


class ExecutionResult(BaseModel):
    schema_version: str = SCHEMA_VERSION
    run_id: str
    status: str
    metrics: dict = Field(default_factory=dict)
    results: list[dict] = Field(default_factory=list)
    evidence: dict = Field(default_factory=dict)
