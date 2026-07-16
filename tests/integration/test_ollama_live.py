"""Live Ollama integration test (SRS §15.1 integration tier).

Runs one real ``analyse_requirement`` call against the local Ollama
instance. Skipped automatically when Ollama is unreachable or the
configured model is not pulled, so offline runs stay green.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.llm import check_ollama_health

pytestmark = pytest.mark.integration

_HEALTH = check_ollama_health()
_MODEL_READY = _HEALTH["available"] and get_settings().llm_model in _HEALTH["models"]

USER_STORY = (
    "As a registered user\n"
    "I want to log in with my email and password\n"
    "So that I can see my personal item list"
)


@pytest.mark.skipif(
    not _MODEL_READY,
    reason=f"Ollama/model unavailable: {_HEALTH['error'] or _HEALTH['models']}",
)
def test_analyse_requirement_live():
    """One real structured-output analysis of a 3-line story (FR-RA-001)."""
    from agents.requirement_agent import analyse_requirement

    result = analyse_requirement(
        USER_STORY,
        ["Valid credentials open the item list"],
        requirement_id="REQ-LOGIN-1",
    )
    assert result.actors, "expected at least one actor extracted from a login story"
    assert result.requirement_id == "REQ-LOGIN-1"
