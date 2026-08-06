"""Shared LangGraph state for the QA workflow (SRS §6.2 Workflow Controller).

The state is the single contract between all workflow nodes (§7). Nodes
return *partial* updates; two channels use reducers:

* ``errors`` accumulates across nodes so any node can record a failure
  without raising and the workflow degrades gracefully (NFR-REL-001);
* ``approval_decisions`` merges per-stage human decisions so the two HITL
  gates (FR-HITL-001..003) never overwrite each other.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


def merge_approval_decisions(
    left: dict[str, dict[str, str]] | None,
    right: dict[str, dict[str, str]] | None,
) -> dict[str, dict[str, str]]:
    """Merge approval decisions from different stages (FR-HITL-003).

    Later decisions for the same stage replace earlier ones (a regenerate
    loop re-asks the human), while decisions for other stages are kept.
    """
    return {**(left or {}), **(right or {})}


class QAWorkflowState(TypedDict, total=False):
    """End-to-end workflow state (SRS §7).

    Keys:
        project_id: Owning :class:`~app.models.entities.Project` id.
        requirement_ids: Requirement ids in scope for this run.
        analyses: requirement_id -> serialised ``RequirementAnalysisOutput``
            (FR-RA-001..004).
        test_plan: Serialised ``TestPlanOutput`` (FR-TP-001..002).
        test_cases: Serialised test cases incl. their DB ``id`` (FR-TC-001..003).
        approved_case_ids: TestCase ids approved by the human (FR-HITL-002).
        generated_files: Serialised ``GeneratedFile`` items (FR-AUT-001..006);
            kept in memory until the code-approval gate passes (SEC-005).
        validation_report: Serialised ``ValidationReport`` (FR-VAL-001..005).
        automation_attempts: How many times generate_automation ran in the
            current regeneration loop; bounds retries (NFR-REL-002).
        approval_decisions: stage -> {decision, actor, comment} (FR-HITL-003).
        execution_run_id: ``ExecutionRun`` id of the local run (FR-EXE-001..).
        classifications: Per-failure classification dicts (FR-RES-002).
        report_paths: {"markdown": path, "html": path} (FR-REP-003).
        errors: Accumulated non-fatal error strings (NFR-REL-001).
        current_stage: Name of the last node that ran (observability, §17).
    """

    project_id: str
    requirement_ids: list[str]
    analyses: dict[str, dict[str, Any]]
    test_plan: dict[str, Any] | None
    test_cases: list[dict[str, Any]]
    approved_case_ids: list[str]
    generated_files: list[dict[str, Any]]
    validation_report: dict[str, Any] | None
    automation_attempts: int
    approval_decisions: Annotated[dict[str, dict[str, str]], merge_approval_decisions]
    execution_run_id: str
    classifications: list[dict[str, Any]]
    report_paths: dict[str, str]
    errors: Annotated[list[str], operator.add]
    current_stage: str
