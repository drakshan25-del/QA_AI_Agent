"""ChatOllama factory and Ollama health checks (NFR-REL, §17 model errors).

All agents obtain their model through :func:`get_chat_model` so that model,
temperature and base URL are configured in exactly one place (NFR-MNT-002)
and recorded per generation run (NFR-EXP-001).
"""

from __future__ import annotations

import httpx
from langchain_ollama import ChatOllama

from app.core.config import get_settings


class OllamaUnavailableError(RuntimeError):
    """Raised when the local Ollama service cannot be reached (§17)."""


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


def require_ollama(model: str | None = None) -> None:
    """Raise OllamaUnavailableError with an actionable message if unusable."""
    settings = get_settings()
    health = check_ollama_health()
    if not health["available"]:
        raise OllamaUnavailableError(
            f"Ollama is not reachable at {settings.ollama_base_url}. "
            f"Start it with 'ollama serve' and retry. Detail: {health['error']}"
        )
    wanted = model or settings.llm_model
    if wanted not in health["models"]:
        raise OllamaUnavailableError(
            f"Model '{wanted}' is not available in Ollama. "
            f"Pull it with 'ollama pull {wanted}'. Available: {health['models']}"
        )


def get_chat_model(
    model: str | None = None,
    temperature: float | None = None,
    *,
    format_json: bool = False,
) -> ChatOllama:
    """Build a ChatOllama instance from settings with optional overrides."""
    settings = get_settings()
    kwargs: dict = {
        "model": model or settings.llm_model,
        "temperature": settings.llm_temperature if temperature is None else temperature,
        "base_url": settings.ollama_base_url,
    }
    if format_json:
        kwargs["format"] = "json"
    return ChatOllama(**kwargs)


def generation_metadata(model: str | None = None, temperature: float | None = None) -> dict:
    """Metadata recorded with every generation run (NFR-EXP-001)."""
    settings = get_settings()
    return {
        "provider": "ollama",
        "base_url": settings.ollama_base_url,
        "model": model or settings.llm_model,
        "temperature": settings.llm_temperature if temperature is None else temperature,
    }
