"""The model factory's context and output bounds (NFR-REL, §17).

Ollama defaults to a 2048-token context and silently discards whatever
overflows it. The generation prompts are larger than that on their own, so the
model loses the head of its instructions and runs out of room mid-answer — which
surfaces as truncated, unparseable code ("'(' was never closed") rather than as
an error, and retries identically every time.

Both bounds are therefore explicit, and this pins them.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.llm import get_chat_model

pytestmark = pytest.mark.unit


def test_context_window_is_set_explicitly() -> None:
    chat = get_chat_model()
    assert chat.num_ctx is not None, "an unset context window falls back to 2048"
    assert chat.num_ctx >= 8192


def test_output_budget_is_set_explicitly() -> None:
    chat = get_chat_model()
    assert chat.num_predict is not None
    assert chat.num_predict >= 2048


def test_context_is_large_enough_for_the_automation_prompt() -> None:
    """The prompt the automation agent sends must fit with room to answer."""
    from agents import automation_agent

    # A conservative 4 characters per token; the real ratio is smaller for
    # code and JSON, so this under-estimates the prompt if anything.
    prompt_tokens = len(automation_agent._SYSTEM_PROMPT) // 4
    settings = get_settings()
    assert settings.llm_context_tokens > prompt_tokens * 2, (
        f"system prompt alone is ~{prompt_tokens} tokens; the context window "
        f"({settings.llm_context_tokens}) leaves no room for the input data "
        "and the generated file"
    )


def test_overrides_still_apply() -> None:
    chat = get_chat_model(model="qwen2.5:latest", temperature=0.7)
    assert chat.model == "qwen2.5:latest"
    assert chat.temperature == 0.7
    assert chat.num_ctx >= 8192
