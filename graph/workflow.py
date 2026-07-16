"""Workflow Controller: LangGraph wiring of the end-to-end QA flow (SRS §6.2, §7).

Graph shape (§7 order)::

    START -> analyse_requirements -> generate_plan -> generate_cases
          -> await_case_approval  --approved-->  generate_automation
                                  --regenerate-> generate_cases
                                  --rejected-->  END
    generate_automation -> validate_code
    validate_code  --passed----------------------> await_code_approval
                   --failed, attempts < budget---> generate_automation  (NFR-REL-002)
                   --failed, budget exhausted----> await_code_approval  (human decides)
    await_code_approval --approved-->  execute_tests
                        --regenerate-> generate_automation
                        --rejected-->  END
    execute_tests -> classify_failures -> generate_report -> END

Both ``await_*`` nodes pause via ``langgraph.types.interrupt`` so a human
approves test cases and generated code before anything is executed
(FR-HITL-001..003). The graph is compiled with an in-memory checkpointer so
interrupted runs can be resumed with ``Command(resume=...)``.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

try:  # MemorySaver was renamed InMemorySaver in newer langgraph releases
    from langgraph.checkpoint.memory import MemorySaver
except ImportError:  # pragma: no cover - depends on installed langgraph
    from langgraph.checkpoint.memory import InMemorySaver as MemorySaver

from app.core.logging import get_logger
from graph import nodes
from graph.state import QAWorkflowState

logger = get_logger(__name__)

#: 1 initial generation + at most 2 automatic retries (NFR-REL-002).
MAX_AUTOMATION_ATTEMPTS = 3

_workflow = None  # module-level singleton so resumes hit the same checkpointer


# ---------------------------------------------------------------------------
# Conditional routers
# ---------------------------------------------------------------------------


def route_after_case_approval(state: QAWorkflowState) -> str:
    """Route on the human's test-case decision (FR-HITL-002).

    approved (with at least one case) -> generate_automation;
    regenerate -> generate_cases; anything else ends the workflow.
    """
    decision = (state.get("approval_decisions") or {}).get("case_approval", {})
    verdict = decision.get("decision", "rejected")
    if verdict == "approved" and state.get("approved_case_ids"):
        return "generate_automation"
    if verdict == "regenerate":
        return "generate_cases"
    return END


def route_after_validation(state: QAWorkflowState) -> str:
    """Route on the validation gate result (FR-VAL-005, NFR-REL-002).

    Passing code goes straight to the human gate. Failing code loops back
    to ``generate_automation`` at most ``MAX_AUTOMATION_ATTEMPTS - 1``
    times; once the budget is exhausted it still goes to the human gate —
    the human sees the failing report and decides (FR-HITL-001).
    """
    report = state.get("validation_report") or {}
    if report.get("passed"):
        return "await_code_approval"
    if int(state.get("automation_attempts") or 0) >= MAX_AUTOMATION_ATTEMPTS:
        logger.warning(
            "validation still failing after %d generation attempts; "
            "escalating to human gate (NFR-REL-002)",
            MAX_AUTOMATION_ATTEMPTS,
        )
        return "await_code_approval"
    return "generate_automation"


def route_after_code_approval(state: QAWorkflowState) -> str:
    """Route on the human's code decision (FR-HITL-001).

    Only an explicit approval reaches execution; regenerate loops back to
    the Automation Agent; anything else ends the workflow safely.
    """
    decision = (state.get("approval_decisions") or {}).get("code_approval", {})
    verdict = decision.get("decision", "rejected")
    if verdict == "approved":
        return "execute_tests"
    if verdict == "regenerate":
        return "generate_automation"
    return END


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def build_workflow(checkpointer: Any | None = None):
    """Build and compile the QA workflow graph (SRS §6.2, §7).

    Args:
        checkpointer: Optional LangGraph checkpointer; defaults to a fresh
            in-memory ``MemorySaver`` (required for ``interrupt()`` /
            ``Command(resume=...)`` to work, FR-HITL-001).

    Returns:
        The compiled ``StateGraph`` ready for ``invoke``/``stream``.
    """
    builder = StateGraph(QAWorkflowState)

    builder.add_node("analyse_requirements", nodes.analyse_requirements)
    builder.add_node("generate_plan", nodes.generate_plan)
    builder.add_node("generate_cases", nodes.generate_cases)
    builder.add_node("await_case_approval", nodes.await_case_approval)
    builder.add_node("generate_automation", nodes.generate_automation)
    builder.add_node("validate_code", nodes.validate_code)
    builder.add_node("await_code_approval", nodes.await_code_approval)
    builder.add_node("execute_tests", nodes.execute_tests)
    builder.add_node("classify_failures", nodes.classify_failures)
    builder.add_node("generate_report", nodes.generate_report)

    builder.add_edge(START, "analyse_requirements")
    builder.add_edge("analyse_requirements", "generate_plan")
    builder.add_edge("generate_plan", "generate_cases")
    builder.add_edge("generate_cases", "await_case_approval")
    builder.add_conditional_edges(
        "await_case_approval",
        route_after_case_approval,
        {
            "generate_automation": "generate_automation",
            "generate_cases": "generate_cases",
            END: END,
        },
    )
    builder.add_edge("generate_automation", "validate_code")
    builder.add_conditional_edges(
        "validate_code",
        route_after_validation,
        {
            "await_code_approval": "await_code_approval",
            "generate_automation": "generate_automation",
        },
    )
    builder.add_conditional_edges(
        "await_code_approval",
        route_after_code_approval,
        {
            "execute_tests": "execute_tests",
            "generate_automation": "generate_automation",
            END: END,
        },
    )
    builder.add_edge("execute_tests", "classify_failures")
    builder.add_edge("classify_failures", "generate_report")
    builder.add_edge("generate_report", END)

    return builder.compile(checkpointer=checkpointer or MemorySaver())


def get_workflow():
    """Process-wide compiled workflow singleton.

    Interrupt/resume requires the SAME checkpointer instance across calls,
    so :func:`run_workflow` always goes through this accessor (FR-HITL-001).
    """
    global _workflow
    if _workflow is None:
        _workflow = build_workflow()
    return _workflow


def run_workflow(
    project_id: str,
    thread_id: str,
    resume_value: Any | None = None,
) -> dict[str, Any]:
    """Start — or resume — one workflow run for a project (SRS §7).

    Args:
        project_id: Project whose requirements drive the run.
        thread_id: Stable checkpoint thread id; reuse the same value to
            resume a paused run.
        resume_value: When resuming from an interrupt, the human decision —
            a ``{"decision": "approved|rejected|regenerate", "actor": ...,
            "comment": ...}`` dict (``ApprovalRequest`` shape) or a bare
            string. ``None`` starts a fresh run.

    Returns:
        The state values after the graph stops. While paused at a human
        gate the result contains ``"__interrupt__"`` — a list of Interrupt
        objects whose ``.value`` describes the pending artefacts
        (FR-HITL-001..002); resume by calling again with ``resume_value``.
    """
    graph = get_workflow()
    config = {"configurable": {"thread_id": thread_id}}
    if resume_value is not None:
        return graph.invoke(Command(resume=resume_value), config)
    initial: QAWorkflowState = {
        "project_id": project_id,
        "errors": [],
        "current_stage": "start",
    }
    return graph.invoke(initial, config)
