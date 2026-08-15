"""Chat-model factory, LLM runtime routing and health checks (NFR-REL, §17).

All agents obtain their model through :func:`get_chat_model` so that model,
temperature and base URL are configured in exactly one place (NFR-MNT-002)
and recorded per generation run (NFR-EXP-001).

Per-project routing (V3): the backend sends an ``llm`` payload with each
generation request — ``{"type": "local"|"cloud", provider, model, apiKey,
baseUrl, temperature}``. The service layer activates it with
:func:`llm_runtime`; while active, :func:`get_chat_model` builds either the
local ChatOllama client or an OpenAI-compatible cloud client from it. The
API key lives only in this in-memory runtime for the duration of one request
and is never logged or echoed into metadata (SEC-007).
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator

import httpx
from langchain_ollama import ChatOllama

from app.core.config import get_settings


class OllamaUnavailableError(RuntimeError):
    """Raised when the local Ollama service cannot be reached (§17)."""


class CloudLLMConfigError(RuntimeError):
    """Raised when a cloud runtime is active but incomplete (bad request)."""


#: Default OpenAI-compatible chat-completions endpoints per cloud provider.
#: ``custom`` has no default — the caller must supply a base URL.
CLOUD_PROVIDER_BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
}


@dataclass(frozen=True)
class LlmRuntime:
    """Per-request LLM routing decision resolved from the active project."""

    type: str = "local"  # "local" | "cloud"
    provider: str = ""
    model: str = ""
    api_key: str = ""
    base_url: str = ""
    temperature: float | None = None

    def resolved_base_url(self) -> str:
        return self.base_url or CLOUD_PROVIDER_BASE_URLS.get(self.provider, "")


_ACTIVE_RUNTIME: ContextVar[LlmRuntime | None] = ContextVar(
    "active_llm_runtime", default=None
)


def runtime_from_payload(payload: dict | None) -> LlmRuntime | None:
    """Parse the backend's ``llm`` request field; None keeps V2 behaviour."""
    if not payload:
        return None
    kind = str(payload.get("type", "local")).lower()
    return LlmRuntime(
        type="cloud" if kind == "cloud" else "local",
        provider=str(payload.get("provider") or ""),
        model=str(payload.get("model") or ""),
        api_key=str(payload.get("apiKey") or ""),
        base_url=str(payload.get("baseUrl") or ""),
        temperature=payload.get("temperature"),
    )


@contextmanager
def llm_runtime(runtime: LlmRuntime | None) -> Iterator[None]:
    """Activate a runtime for the current request context."""
    token = _ACTIVE_RUNTIME.set(runtime)
    try:
        yield
    finally:
        _ACTIVE_RUNTIME.reset(token)


def active_runtime() -> LlmRuntime | None:
    return _ACTIVE_RUNTIME.get()


def check_ollama_health(base_url: str | None = None, timeout: float = 3.0) -> dict:
    """Return {'available': bool, 'models': [names], 'error': str|None}."""
    settings = get_settings()
    url = (base_url or settings.ollama_base_url).rstrip("/")
    try:
        resp = httpx.get(f"{url}/api/tags", timeout=timeout)
        resp.raise_for_status()
        models = [m["name"] for m in resp.json().get("models", [])]
        return {"available": True, "models": models, "error": None}
    except Exception as exc:  # noqa: BLE001 - reported to caller, never crashes flow
        return {"available": False, "models": [], "error": str(exc)}


def _require_cloud_config(runtime: LlmRuntime) -> None:
    """Fail fast (and clearly) when the cloud runtime is unusable."""
    if not runtime.model:
        raise CloudLLMConfigError("Cloud LLM model is not configured for this project.")
    if not runtime.api_key:
        raise CloudLLMConfigError("Cloud LLM API key is not configured for this project.")
    if not runtime.resolved_base_url():
        raise CloudLLMConfigError(
            f"Cloud provider '{runtime.provider or 'custom'}' needs a base URL."
        )


def require_ollama(model: str | None = None) -> None:
    """Ensure the active LLM backend is usable before generation starts.

    Cloud runtimes skip the Ollama health check entirely — their readiness is
    the presence of a complete configuration; provider errors surface from the
    request itself.
    """
    runtime = _ACTIVE_RUNTIME.get()
    if runtime is not None and runtime.type == "cloud":
        _require_cloud_config(runtime)
        return
    settings = get_settings()
    health = check_ollama_health()
    if not health["available"]:
        raise OllamaUnavailableError(
            f"Ollama is not reachable at {settings.ollama_base_url}. "
            f"Start it with 'ollama serve' and retry. Detail: {health['error']}"
        )
    wanted = model or (runtime.model if runtime else "") or settings.llm_model
    if wanted not in health["models"]:
        raise OllamaUnavailableError(
            f"Model '{wanted}' is not available in Ollama. "
            f"Pull it with 'ollama pull {wanted}'. Available: {health['models']}"
        )


def _cloud_chat_model(
    runtime: LlmRuntime, temperature: float | None, *, format_json: bool
):
    """Build the OpenAI-compatible cloud client (imported lazily)."""
    _require_cloud_config(runtime)
    settings = get_settings()
    from langchain_openai import ChatOpenAI

    class _CloudChat(ChatOpenAI):
        """ChatOpenAI adapted to the quirks of OpenAI-compatible providers.

        * Structured output binds tools by default: langchain's
          ``json_schema`` method uses the ``chat.completions.parse`` shape,
          which several compatibility layers (e.g. Anthropic's) reject;
          plain function calling is the shape they all support. Callers may
          still pass an explicit ``method`` to override.
        * Newer model generations (Claude 5, gpt-5/o-series) reject the
          ``temperature`` parameter outright; on that specific 400 the
          parameter is dropped and the request retried once.
        """

        def with_structured_output(self, schema=None, **kwargs):  # type: ignore[override]
            kwargs.setdefault("method", "function_calling")
            return super().with_structured_output(schema, **kwargs)

        def _generate(self, *args, **kwargs):  # type: ignore[override]
            import openai

            try:
                return super()._generate(*args, **kwargs)
            except openai.BadRequestError as exc:
                if self.temperature is not None and "temperature" in str(exc).lower():
                    self.temperature = None
                    return super()._generate(*args, **kwargs)
                raise

    if temperature is None:
        temperature = (
            runtime.temperature
            if runtime.temperature is not None
            else settings.llm_temperature
        )
    kwargs: dict = {
        "model": runtime.model,
        "api_key": runtime.api_key,
        "base_url": runtime.resolved_base_url(),
        "temperature": temperature,
        "timeout": settings.llm_timeout_seconds,
        "max_retries": settings.llm_max_retries,
    }
    if format_json:
        kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
    return _CloudChat(**kwargs)


def get_chat_model(
    model: str | None = None,
    temperature: float | None = None,
    *,
    format_json: bool = False,
):
    """Build the chat model for the active runtime (local Ollama or cloud).

    A cloud runtime takes precedence over any positional ``model`` argument:
    those arguments carry the project's *local* model name, which is
    meaningless on a cloud provider.
    """
    settings = get_settings()
    runtime = _ACTIVE_RUNTIME.get()
    if runtime is not None and runtime.type == "cloud":
        return _cloud_chat_model(runtime, temperature, format_json=format_json)
    if temperature is None and runtime is not None and runtime.temperature is not None:
        temperature = runtime.temperature
    kwargs: dict = {
        "model": model or (runtime.model if runtime else "") or settings.llm_model,
        "temperature": settings.llm_temperature if temperature is None else temperature,
        "base_url": settings.ollama_base_url,
        # Bound every model call's wall clock (§17 model errors): a hung
        # Ollama request must fail loudly instead of pinning a worker thread.
        "client_kwargs": {"timeout": settings.llm_timeout_seconds},
    }
    if format_json:
        kwargs["format"] = "json"
    return ChatOllama(**kwargs)


def active_model_label(requested: str | None = None) -> str:
    """Human-readable label of the model actually in use, for logs/errors.

    A cloud runtime reports ``provider:model`` so failures are attributed to
    the right backend instead of the project's (unused) local model name.
    """
    runtime = _ACTIVE_RUNTIME.get()
    if runtime is not None and runtime.type == "cloud":
        return f"{runtime.provider or 'custom'}:{runtime.model}"
    return requested or (runtime.model if runtime else "") or get_settings().llm_model


def generation_metadata(model: str | None = None, temperature: float | None = None) -> dict:
    """Metadata recorded with every generation run (NFR-EXP-001).

    Never includes credentials — only provider, endpoint and model identity.
    """
    settings = get_settings()
    runtime = _ACTIVE_RUNTIME.get()
    if runtime is not None and runtime.type == "cloud":
        return {
            "provider": runtime.provider or "custom",
            "base_url": runtime.resolved_base_url(),
            "model": runtime.model,
            "temperature": (
                runtime.temperature
                if temperature is None and runtime.temperature is not None
                else (settings.llm_temperature if temperature is None else temperature)
            ),
        }
    return {
        "provider": "ollama",
        "base_url": settings.ollama_base_url,
        "model": model or (runtime.model if runtime else "") or settings.llm_model,
        "temperature": settings.llm_temperature if temperature is None else temperature,
    }
