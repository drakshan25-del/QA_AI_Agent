"""Report Agent: defect drafting and run narrative generation.

Implements:
    - FR-BUG-001: draft defect reports with all mandatory fields (title,
      description, environment, severity/priority, preconditions,
      steps to reproduce, expected vs actual result, evidence references).
    - FR-REP-002: produce a short AI narrative for the execution report;
      the caller is responsible for labelling it as AI-generated.

Both entry points use structured output with bounded retries so callers
never receive unvalidated free text (except the narrative, which is still
schema-validated before its text is returned).
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.llm import get_chat_model, require_ollama
from app.core.logging import get_logger
from app.core.security import redact_secrets
from app.models.schemas import DefectDraftOutput, FailureClassificationOutput

logger = get_logger(__name__)

PROMPT_VERSION = "v1"

_MAX_ERROR_CHARS = 4000
_VALID_SEVERITIES = {"low", "medium", "high", "critical"}

_DEFECT_SYSTEM_PROMPT = (
    "You are a senior QA engineer writing a defect report from an automated "
    "test failure. Fill every field: a concise imperative title; a factual "
    "description grounded in the evidence; preconditions; numbered "
    "steps_to_reproduce derived from the test steps provided (do not invent "
    "steps); expected_result from the requirement/assertion expectation; "
    "actual_result from the observed error text. Severity is one of "
    "low|medium|high|critical and priority one of low|medium|high|critical. "
    "Never speculate beyond the evidence and never include credentials."
)

_NARRATIVE_SYSTEM_PROMPT = (
    "You are a QA lead summarising an automated test run for stakeholders. "
    "Write a factual 1-2 paragraph narrative in plain English: overall "
    "outcome, notable failures and their likely nature, and what should "
    "happen next. Use only the numbers and facts provided - do not invent "
    "metrics. No headings, no bullet lists, just prose."
)


class _RunNarrative(BaseModel):
    """Schema wrapper so the narrative is validated, not raw text."""

    narrative: str = Field(description="1-2 paragraph plain-English summary of the run")


def draft_defect(
    test: dict,
    classification: FailureClassificationOutput,
    requirement: dict,
    evidence_refs: list[str],
    environment: str,
    model: str | None = None,
    temperature: float | None = None,
) -> DefectDraftOutput:
    """Draft a complete defect report for a classified failure (FR-BUG-001).

    steps_to_reproduce are derived from the executed test steps and
    expected vs actual results from the requirement and assertion text.
    Environment and evidence references are set deterministically from the
    caller's arguments so the LLM cannot invent them.

    Args:
        test: ``{"node_id": str, "error_message": str, "duration": float,
            "steps": list[str], "title": str}`` for the failed test.
        classification: Validated output of the Result Analysis Agent.
        requirement: ``{"id": str, "title": str, "text": str}``.
        evidence_refs: Paths/URLs of screenshots, traces, logs.
        environment: Environment name the failure occurred in.

    Returns:
        A validated :class:`DefectDraftOutput` with all mandatory fields set.

    Raises:
        OllamaUnavailableError: If the local model is not reachable.
        RuntimeError: If no valid structured output is produced within the
            configured retry budget.
    """
    require_ollama(model)
    settings = get_settings()

    # Secrets never enter prompts (FR-CI-004 / SEC-007).
    error_text = redact_secrets(str(test.get("error_message", "")))[:_MAX_ERROR_CHARS]
    steps = [str(s) for s in (test.get("steps") or [])]
    steps_block = "\n".join(f"  {i}. {s}" for i, s in enumerate(steps, 1)) or "  (not recorded)"

    human_prompt = (
        f"Failed test: {test.get('node_id', '(unknown)')}\n"
        f"Test case title: {test.get('title', '(not provided)')}\n\n"
        f"Requirement {requirement.get('id', '')} - {requirement.get('title', '')}:\n"
        f"{requirement.get('text', '(not provided)')}\n\n"
        f"Executed test steps (base steps_to_reproduce on these):\n{steps_block}\n\n"
        f"Observed error / assertion text (base actual_result on this):\n"
        f"---\n{error_text or '(empty error message)'}\n---\n\n"
        f"Triage classification: {classification.classification} "
        f"(confidence {classification.confidence:.2f}, severity {classification.severity})\n"
        f"Triage rationale: {classification.rationale}\n\n"
        "Write the defect report now."
    )

    chat = get_chat_model(model=model, temperature=temperature).with_structured_output(DefectDraftOutput)
    messages = [("system", _DEFECT_SYSTEM_PROMPT), ("human", human_prompt)]

    attempts = settings.llm_max_retries + 1
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            draft = chat.invoke(messages)
            if isinstance(draft, dict):
                draft = DefectDraftOutput.model_validate(draft)
            if not draft.title.strip():
                raise ValueError("defect title is mandatory (FR-BUG-001)")
            if not draft.description.strip():
                raise ValueError("defect description is mandatory (FR-BUG-001)")
            # Deterministic mandatory fields the LLM must not control/invent.
            draft.environment = environment
            draft.evidence_refs = list(evidence_refs)
            if not draft.steps_to_reproduce and steps:
                draft.steps_to_reproduce = steps
            if draft.severity not in _VALID_SEVERITIES:
                draft.severity = classification.severity
            if not draft.actual_result.strip() and error_text:
                draft.actual_result = error_text.splitlines()[0][:300]
            return draft
        except Exception as exc:  # noqa: BLE001 - retried, then surfaced below
            last_error = exc
            logger.warning("draft_defect attempt %d/%d failed: %s", attempt, attempts, exc)

    raise RuntimeError(
        f"Defect drafting produced no valid structured output after "
        f"{attempts} attempt(s) (FR-BUG-001). Last error: {last_error}"
    )


def summarise_run(
    run_summary: dict,
    model: str | None = None,
    temperature: float | None = None,
) -> str:
    """Generate a 1-2 paragraph AI narrative for a run report (FR-REP-002).

    The caller MUST label the returned text as AI-generated when rendering
    it; this function returns the narrative text only.

    Args:
        run_summary: JSON-serialisable dict of measured facts, e.g.
            ``{"run_id", "status", "environment", "metrics": {...},
            "failures": [{"node_id", "classification"}, ...]}``.

    Returns:
        The narrative text (validated non-empty).

    Raises:
        OllamaUnavailableError: If the local model is not reachable.
        RuntimeError: If no valid narrative is produced within the retry
            budget.
    """
    require_ollama(model)
    settings = get_settings()

    facts = redact_secrets(json.dumps(run_summary, default=str, indent=2))[:6000]
    human_prompt = (
        "Measured facts of the automated test run (the only source of truth):\n"
        f"{facts}\n\n"
        "Write the 1-2 paragraph narrative now."
    )

    chat = get_chat_model(model=model, temperature=temperature).with_structured_output(_RunNarrative)
    messages = [("system", _NARRATIVE_SYSTEM_PROMPT), ("human", human_prompt)]

    attempts = settings.llm_max_retries + 1
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            result = chat.invoke(messages)
            if isinstance(result, dict):
                result = _RunNarrative.model_validate(result)
            text = result.narrative.strip()
            if not text:
                raise ValueError("empty narrative")
            return text
        except Exception as exc:  # noqa: BLE001 - retried, then surfaced below
            last_error = exc
            logger.warning("summarise_run attempt %d/%d failed: %s", attempt, attempts, exc)

    raise RuntimeError(
        f"Run summarisation produced no valid narrative after {attempts} "
        f"attempt(s) (FR-REP-002). Last error: {last_error}"
    )
