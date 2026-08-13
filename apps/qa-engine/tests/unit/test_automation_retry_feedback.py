"""Unit tests for the automation generation retry loop (FR-AUT-008).

A rejected attempt must not be replayed verbatim: the retry prompt has to
carry the model's previous output and the rejection reason so the model can
repair the file instead of regenerating the same broken one.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from agents import automation_agent
from app.models.schemas import AutomationOutput, GeneratedFile

pytestmark = pytest.mark.unit


BROKEN_TEST = "import pytest\n\ndef test_login(:\n    pass\n"
VALID_TEST = (
    "import pytest\n"
    "\n"
    "# TC: TC-1 Login works\n"
    "# REQ: REQ-1\n"
    "def test_login(page, base_url, credentials, target_available):\n"
    "    assert True\n"
)


def _output(content: str) -> AutomationOutput:
    return AutomationOutput(
        files=[
            GeneratedFile(
                path="automation/generated_tests/test_login.py",
                kind="test_file",
                content=content,
                test_case_ids=["TC-1"],
            )
        ]
    )


class _FakeStructuredChat:
    """Pops one canned AutomationOutput per invoke, recording the messages."""

    def __init__(self, queue: list[AutomationOutput], calls: list[list]):
        self._queue = queue
        self._calls = calls

    def invoke(self, messages):
        self._calls.append(list(messages))
        return self._queue.pop(0)


def test_retry_feeds_rejection_back_to_model(monkeypatch):
    queue = [_output(BROKEN_TEST), _output(VALID_TEST)]
    calls: list[list] = []

    class FakeChat:
        def with_structured_output(self, schema):
            return _FakeStructuredChat(queue, calls)

    monkeypatch.setattr(automation_agent, "require_ollama", lambda model=None: None)
    monkeypatch.setattr(automation_agent, "get_chat_model", lambda *a, **k: FakeChat())
    monkeypatch.setattr(automation_agent, "_effective_automation_model", lambda requested: requested)

    result = automation_agent.generate_automation(
        [{"id": "TC-1", "title": "Login works"}], "http://localhost", ""
    )

    assert any(f.kind == "test_file" for f in result.files)
    assert len(calls) == 2

    first, second = calls
    # The retry prompt must have grown: previous output + rejection feedback.
    assert len(second) == len(first) + 2
    assert isinstance(second[-2], AIMessage)
    assert "test_login" in second[-2].content
    assert isinstance(second[-1], HumanMessage)
    assert "rejected" in second[-1].content
    assert "does not parse" in second[-1].content


def test_all_attempts_exhausted_still_raises(monkeypatch):
    settings = automation_agent.get_settings()
    attempts = settings.llm_max_retries + 1
    queue = [_output(BROKEN_TEST) for _ in range(attempts)]
    calls: list[list] = []

    class FakeChat:
        def with_structured_output(self, schema):
            return _FakeStructuredChat(queue, calls)

    monkeypatch.setattr(automation_agent, "require_ollama", lambda model=None: None)
    monkeypatch.setattr(automation_agent, "get_chat_model", lambda *a, **k: FakeChat())
    monkeypatch.setattr(automation_agent, "_effective_automation_model", lambda requested: requested)

    with pytest.raises(RuntimeError, match="does not parse"):
        automation_agent.generate_automation(
            [{"id": "TC-1", "title": "Login works"}], "http://localhost", ""
        )
    assert len(calls) == attempts
