"""Per-project LLM runtime routing (LOCAL/Ollama vs CLOUD provider).

Covers the factory contract every AI workflow depends on: the active runtime
decides which client class, model and endpoint are used, cloud credentials
never leak into metadata, and an incomplete cloud configuration fails fast
with an actionable error instead of a provider 401.
"""

from __future__ import annotations

import pytest
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from app.core.llm import (
    CLOUD_PROVIDER_BASE_URLS,
    CloudLLMConfigError,
    LlmRuntime,
    active_runtime,
    generation_metadata,
    get_chat_model,
    llm_runtime,
    require_ollama,
    runtime_from_payload,
)

CLOUD_PAYLOAD = {
    "type": "cloud",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-unit-test",
    "temperature": 0.2,
}


def test_runtime_from_payload_parses_cloud() -> None:
    rt = runtime_from_payload(CLOUD_PAYLOAD)
    assert rt is not None
    assert rt.type == "cloud"
    assert rt.provider == "openai"
    assert rt.model == "gpt-4o-mini"
    assert rt.api_key == "sk-unit-test"
    assert rt.temperature == 0.2


def test_runtime_from_payload_none_keeps_v2_behaviour() -> None:
    assert runtime_from_payload(None) is None
    assert runtime_from_payload({}) is None


def test_context_is_scoped() -> None:
    assert active_runtime() is None
    with llm_runtime(runtime_from_payload(CLOUD_PAYLOAD)):
        assert active_runtime() is not None
    assert active_runtime() is None


def test_cloud_runtime_builds_openai_client_with_provider_base_url() -> None:
    with llm_runtime(runtime_from_payload(CLOUD_PAYLOAD)):
        model = get_chat_model("qwen2.5:latest")  # local arg must be ignored
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gpt-4o-mini"
    assert model.openai_api_base == CLOUD_PROVIDER_BASE_URLS["openai"]
    assert model.temperature == 0.2


def test_cloud_base_url_override_wins() -> None:
    rt = LlmRuntime(
        type="cloud",
        provider="custom",
        model="m",
        api_key="k",
        base_url="https://gw.example.com/v1",
    )
    with llm_runtime(rt):
        model = get_chat_model()
    assert isinstance(model, ChatOpenAI)
    assert model.openai_api_base == "https://gw.example.com/v1"


def test_cloud_structured_output_defaults_to_function_calling() -> None:
    """Providers like Anthropic's OpenAI-compat layer reject langchain's
    default json_schema/parse shape; the cloud client must bind tools."""
    from pydantic import BaseModel

    class _Out(BaseModel):
        hi: str

    with llm_runtime(runtime_from_payload(CLOUD_PAYLOAD)):
        bound = get_chat_model().with_structured_output(_Out)
    kwargs = bound.first.kwargs  # RunnableBinding of the bound chat model
    assert "tools" in kwargs, kwargs.keys()
    assert "response_format" not in kwargs


def test_cloud_temperature_rejection_self_heals(monkeypatch) -> None:
    """Claude 5 / gpt-5 class models 400 on `temperature`; the cloud client
    must drop the parameter and retry instead of failing the generation."""
    import httpx
    import openai
    from langchain_openai import ChatOpenAI

    seen_temperatures: list[float | None] = []

    def fake_generate(self, *args, **kwargs):
        seen_temperatures.append(self.temperature)
        if self.temperature is not None:
            request = httpx.Request("POST", "https://api.anthropic.com/v1/chat/completions")
            raise openai.BadRequestError(
                "Error code: 400 - `temperature` is deprecated for this model.",
                response=httpx.Response(400, request=request),
                body=None,
            )
        return "generated"

    monkeypatch.setattr(ChatOpenAI, "_generate", fake_generate)
    with llm_runtime(runtime_from_payload(CLOUD_PAYLOAD)):
        model = get_chat_model()
    assert model._generate() == "generated"
    assert seen_temperatures == [0.2, None]


def test_local_runtime_uses_ollama_and_project_model() -> None:
    rt = LlmRuntime(type="local", model="qwen3:8b")
    with llm_runtime(rt):
        model = get_chat_model()
    assert isinstance(model, ChatOllama)
    assert model.model == "qwen3:8b"


def test_no_runtime_keeps_default_local_behaviour() -> None:
    model = get_chat_model("deepseek-r1:8b")
    assert isinstance(model, ChatOllama)
    assert model.model == "deepseek-r1:8b"


@pytest.mark.parametrize(
    "payload, missing",
    [
        ({**CLOUD_PAYLOAD, "apiKey": ""}, "API key"),
        ({**CLOUD_PAYLOAD, "model": ""}, "model"),
        ({"type": "cloud", "provider": "custom", "model": "m", "apiKey": "k"}, "base URL"),
    ],
)
def test_incomplete_cloud_config_fails_fast(payload: dict, missing: str) -> None:
    with llm_runtime(runtime_from_payload(payload)):
        with pytest.raises(CloudLLMConfigError, match=missing):
            get_chat_model()


def test_require_ollama_skips_health_check_for_cloud(monkeypatch) -> None:
    def boom(*_a, **_k):  # any Ollama probe in cloud mode is a routing bug
        raise AssertionError("check_ollama_health must not be called in cloud mode")

    monkeypatch.setattr("app.core.llm.check_ollama_health", boom)
    with llm_runtime(runtime_from_payload(CLOUD_PAYLOAD)):
        require_ollama()  # must not raise


def test_generation_metadata_never_contains_credentials() -> None:
    with llm_runtime(runtime_from_payload(CLOUD_PAYLOAD)):
        md = generation_metadata()
    assert md["provider"] == "openai"
    assert md["model"] == "gpt-4o-mini"
    flat = str(md)
    assert "sk-unit-test" not in flat
    assert "api_key" not in flat.lower().replace("base_url", "")


def test_local_metadata_reports_ollama() -> None:
    md = generation_metadata("qwen2.5:latest")
    assert md["provider"] == "ollama"
    assert md["model"] == "qwen2.5:latest"
