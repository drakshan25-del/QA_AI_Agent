"""Result Analysis Agent: failure classification with deterministic evidence.

Implements:
    - FR-RES-002: classify each failure as app_defect | test_defect |
      environment | data | inconclusive with a confidence score.
    - FR-RES-003: gather deterministic heuristic evidence from the raw error
      text BEFORE invoking the AI, and feed that evidence into the prompt.
    - NFR-EXP-002: the rationale must cite the actual error text, never just
      restate the label.

The LLM is only ever called through structured output so downstream code
receives a validated ``FailureClassificationOutput``, never free text.
"""

from __future__ import annotations

import re

from app.core.config import get_settings
from app.core.llm import get_chat_model, require_ollama
from app.core.logging import get_logger
from app.core.security import redact_secrets
from app.models.schemas import FailureClassificationOutput

logger = get_logger(__name__)

PROMPT_VERSION = "v1"

VALID_CLASSIFICATIONS: frozenset[str] = frozenset(
    {"app_defect", "test_defect", "environment", "data", "inconclusive"}
)

# Maximum characters of raw error output forwarded to the model.
_MAX_ERROR_CHARS = 4000

# Ordered deterministic rules (FR-RES-003). First match wins, so
# infrastructure signals are checked before assertion signals: a connection
# error frequently *causes* a downstream assertion failure.
_HEURISTIC_RULES: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(r"(?i)connection\s+refused|ECONNREFUSED|ERR_CONNECTION_\w+"),
        "environment",
        "Connection-refused pattern: the target application or service was not reachable",
    ),
    (
        re.compile(r"net::\w+"),
        "environment",
        "Chromium network-stack error (net::): browser could not complete the request",
    ),
    (
        re.compile(r"(?i)\bERR_NAME_NOT_RESOLVED\b|\bENOTFOUND\b|getaddrinfo\s+failed"),
        "environment",
        "DNS/name-resolution failure: environment configuration problem",
    ),
    (
        re.compile(r"(?i)time[d\s]*out.{0,120}waiting\s+for\s+(locator|selector|element)"),
        "test_defect",
        "Timeout waiting for a locator: the selector is likely stale or wrong in the test",
    ),
    (
        re.compile(r"(?i)TimeoutError.{0,160}(locator|selector|get_by_|frame|page\.)"),
        "test_defect",
        "Playwright timeout tied to a locator/page action: probable brittle or wrong selector",
    ),
    (
        re.compile(r"(?i)\b(ImportError|ModuleNotFoundError|SyntaxError|IndentationError)\b"),
        "test_defect",
        "Import/syntax error: the test code itself is broken, not the application",
    ),
    (
        re.compile(r"(?i)fixture\s+'?[\w\-]+'?\s+not\s+found|error\s+at\s+(setup|teardown)\b"),
        "test_defect",
        "Pytest fixture/setup error: defect in test harness code",
    ),
    (
        re.compile(r"(?i)\bAssertionError\b|^\s*assert\b|\bassert\s+\S+.{0,120}(==|!=|\bin\b|<=|>=)"),
        "app_defect",
        "Assertion mismatch: observed application behaviour differed from the expectation",
    ),
]

_SYSTEM_PROMPT = (
    "You are a senior QA engineer triaging automated UI/API test failures. "
    "Classify the failure as exactly one of: app_defect (the application "
    "violates the requirement), test_defect (the test code, selectors or "
    "fixtures are wrong), environment (service down, network, browser or "
    "infrastructure problem), data (test data missing, stale or invalid), or "
    "inconclusive (evidence is insufficient to decide). "
    "Your rationale MUST quote or reference the concrete error text provided "
    "as evidence - never just restate the label. Weigh the deterministic "
    "heuristic evidence, but override it when the error text supports a "
    "different classification. Set confidence between 0 and 1 and severity "
    "as one of low|medium|high|critical."
)


def heuristic_preclassify(error_message: str) -> dict:
    """Deterministic pre-classification of a raw error message (FR-RES-003).

    Runs BEFORE any AI call so the pipeline always has reproducible,
    rule-based evidence, even when the LLM is unavailable.

    Args:
        error_message: Raw error/traceback text captured for the failed test.

    Returns:
        ``{"hint": <classification hint>, "reason": <why the rule fired>}``.
        ``hint`` is one of the valid classifications; ``inconclusive`` when
        no rule matches.
    """
    text = error_message or ""
    for pattern, hint, reason in _HEURISTIC_RULES:
        match = pattern.search(text)
        if match:
            snippet = match.group(0).strip()[:80]
            return {"hint": hint, "reason": f"{reason} (matched: {snippet!r})"}
    return {
        "hint": "inconclusive",
        "reason": "No deterministic failure pattern matched the error text.",
    }


def classify_failure(
    test: dict,
    context: dict,
    model: str | None = None,
    temperature: float | None = None,
) -> FailureClassificationOutput:
    """Classify one failed test via LLM structured output (FR-RES-002).

    The prompt embeds the deterministic heuristic hint as evidence
    (FR-RES-003) and demands a rationale citing the actual error text
    (NFR-EXP-002). Retries are bounded by ``Settings.llm_max_retries``.

    Args:
        test: ``{"node_id": str, "error_message": str, "duration": float}``.
        context: ``{"requirement_text": str, "test_case_title": str,
            "steps": list[str]}`` giving traceability context.

    Returns:
        A validated :class:`FailureClassificationOutput`.

    Raises:
        OllamaUnavailableError: If the local model is not reachable.
        RuntimeError: If no valid structured output is produced within the
            configured retry budget (unvalidated text is never returned).
    """
    require_ollama(model)
    settings = get_settings()

    # Secrets never enter prompts (FR-CI-004 / SEC-007).
    error_text = redact_secrets(str(test.get("error_message", "")))[:_MAX_ERROR_CHARS]
    heuristic = heuristic_preclassify(error_text)
    steps = [str(s) for s in (context.get("steps") or [])]
    steps_block = "\n".join(f"  {i}. {s}" for i, s in enumerate(steps, 1)) or "  (not recorded)"

    human_prompt = (
        f"Failed test: {test.get('node_id', '(unknown)')}\n"
        f"Duration: {test.get('duration', 'n/a')} seconds\n\n"
        f"Requirement under test:\n{context.get('requirement_text', '(not provided)')}\n\n"
        f"Test case: {context.get('test_case_title', '(not provided)')}\n"
        f"Test steps:\n{steps_block}\n\n"
        f"Raw error output (evidence to cite in your rationale):\n"
        f"---\n{error_text or '(empty error message)'}\n---\n\n"
        f"Deterministic heuristic evidence (rule-based pre-classification, FR-RES-003):\n"
        f"  hint: {heuristic['hint']}\n"
        f"  reason: {heuristic['reason']}\n\n"
        "Classify this failure. In the rationale, quote the decisive fragment "
        "of the raw error output above and explain why it supports your "
        "classification."
    )

    chat = get_chat_model(model=model, temperature=temperature).with_structured_output(
        FailureClassificationOutput
    )
    messages = [("system", _SYSTEM_PROMPT), ("human", human_prompt)]

    attempts = settings.llm_max_retries + 1
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            result = chat.invoke(messages)
            if isinstance(result, dict):  # some providers return raw dicts
                result = FailureClassificationOutput.model_validate(result)
            if result.classification not in VALID_CLASSIFICATIONS:
                raise ValueError(
                    f"invalid classification {result.classification!r}, "
                    f"expected one of {sorted(VALID_CLASSIFICATIONS)}"
                )
            if not result.rationale.strip():
                raise ValueError("empty rationale violates NFR-EXP-002")
            return result
        except Exception as exc:  # noqa: BLE001 - retried, then surfaced below
            last_error = exc
            logger.warning(
                "classify_failure attempt %d/%d failed: %s", attempt, attempts, exc
            )

    raise RuntimeError(
        f"Failure classification produced no valid structured output after "
        f"{attempts} attempt(s) (FR-RES-002). Last error: {last_error}"
    )
