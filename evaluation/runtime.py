"""Runtime model injection + token capture — the non-invasive evaluation hook.

The application always generates with a single configured model. To evaluate N
models *without modifying the app*, :func:`use_model` temporarily:

1. overrides the cached ``Settings.llm_model`` (so ``require_ollama()`` and any
   default ``get_chat_model()`` target the chosen model), and
2. wraps ``get_chat_model`` — **in each agent module's namespace**, because the
   agents did ``from app.core.llm import get_chat_model`` (a name bound at import
   time) — so the returned chat model carries a callback that records Ollama
   token counts and call attempts.

Everything is restored on exit. No file under ``app/`` or ``agents/`` changes.
Token capture is best-effort (latency is always measured directly); a model that
does not report usage simply yields ``None`` token fields.
"""

from __future__ import annotations

import importlib
from contextlib import contextmanager
from typing import Any

import httpx
from langchain_core.callbacks.base import BaseCallbackHandler

#: Agent modules that did ``from app.core.llm import get_chat_model`` and must be
#: patched by name (patching only the source module would miss these bindings).
_AGENT_MODULES = (
    "agents.test_plan_agent",
    "agents.test_case_agent",
    "agents.automation_agent",
)


class _TokenCaptureHandler(BaseCallbackHandler):
    """LangChain callback that accumulates token usage + call count into a sink.

    Ollama reports usage either as ``AIMessage.usage_metadata`` (newer
    langchain-ollama) or as ``prompt_eval_count`` / ``eval_count`` in
    ``response_metadata``. Both are handled; failures are swallowed so token
    accounting never breaks a generation.
    """

    def __init__(self, sink: dict[str, Any]) -> None:
        self.sink = sink

    def on_llm_start(self, *args: Any, **kwargs: Any) -> None:
        self.sink["llm_calls"] = int(self.sink.get("llm_calls") or 0) + 1

    # chat models emit on_llm_end with an LLMResult carrying ChatGenerations
    def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ANN401
        try:
            for generations in getattr(response, "generations", []) or []:
                for gen in generations:
                    self._accumulate(getattr(gen, "message", None))
        except Exception:  # noqa: BLE001 - best-effort, never raise from a callback
            pass

    def _accumulate(self, message: Any) -> None:  # noqa: ANN401
        if message is None:
            return
        usage = getattr(message, "usage_metadata", None)
        prompt = completion = None
        if usage:
            prompt = usage.get("input_tokens")
            completion = usage.get("output_tokens")
        else:
            meta = getattr(message, "response_metadata", {}) or {}
            prompt = meta.get("prompt_eval_count")
            completion = meta.get("eval_count")
        if prompt is not None:
            self.sink["tokens_prompt"] = int(self.sink.get("tokens_prompt") or 0) + int(prompt)
        if completion is not None:
            self.sink["tokens_completion"] = (
                int(self.sink.get("tokens_completion") or 0) + int(completion)
            )
        if prompt is not None or completion is not None:
            self.sink["tokens_total"] = int(self.sink.get("tokens_prompt") or 0) + int(
                self.sink.get("tokens_completion") or 0
            )


@contextmanager
def use_model(model_tag: str, token_sink: dict[str, Any] | None = None):
    """Temporarily force all agent generation to use ``model_tag``.

    Args:
        model_tag: Ollama model tag to evaluate.
        token_sink: Optional dict to receive ``tokens_prompt/completion/total``
            and ``llm_calls``. A fresh dict is used if omitted.

    Yields:
        The token sink dict (populated as generation proceeds).
    """
    import app.core.llm as llm_mod
    from app.core.config import get_settings

    sink: dict[str, Any] = token_sink if token_sink is not None else {}
    settings = get_settings()
    original_model = settings.llm_model
    original_get_chat = llm_mod.get_chat_model

    agent_mods = [importlib.import_module(name) for name in _AGENT_MODULES]
    original_agent_refs = {
        mod: mod.get_chat_model for mod in agent_mods if hasattr(mod, "get_chat_model")
    }

    def patched_get_chat_model(*args: Any, **kwargs: Any):
        # Force the selected model unless a caller explicitly names one.
        if not args and "model" not in kwargs:
            kwargs["model"] = model_tag
        model = original_get_chat(*args, **kwargs)
        try:  # attach token capture; propagates through with_structured_output
            existing = list(getattr(model, "callbacks", None) or [])
            model.callbacks = existing + [_TokenCaptureHandler(sink)]
        except Exception:  # noqa: BLE001 - never block generation on instrumentation
            pass
        return model

    settings.llm_model = model_tag
    llm_mod.get_chat_model = patched_get_chat_model
    for mod in original_agent_refs:
        mod.get_chat_model = patched_get_chat_model
    try:
        yield sink
    finally:
        settings.llm_model = original_model
        llm_mod.get_chat_model = original_get_chat
        for mod, ref in original_agent_refs.items():
            mod.get_chat_model = ref


def ollama_model_footprint(model_tag: str, base_url: str = "http://localhost:11434") -> dict:
    """Best-effort memory footprint of a *currently loaded* Ollama model.

    Queries ``/api/ps`` for the resident model. This is the honest memory signal
    for local LLM evaluation: the model's weights live in the Ollama server
    process, not in this Python process, so sampling our own RSS would be
    meaningless. Returns ``{}`` if the model is not loaded or Ollama is
    unreachable.
    """
    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/api/ps", timeout=5.0)
        resp.raise_for_status()
        for entry in resp.json().get("models", []):
            if entry.get("name") == model_tag or entry.get("model") == model_tag:
                return {
                    "size_bytes": entry.get("size"),
                    "size_vram_bytes": entry.get("size_vram"),
                }
    except Exception:  # noqa: BLE001 - optional metric
        return {}
    return {}
