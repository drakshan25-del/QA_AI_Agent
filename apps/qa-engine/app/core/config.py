"""Application settings loaded from environment / .env (SEC-002: no secrets in code)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="QA_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Agentic AI QA System"
    database_url: str = "sqlite:///./qa_agents.db"
    artifacts_dir: str = "artifacts"
    reports_dir: str = "reports"
    generated_tests_dir: str = "automation/generated_tests"

    # Local LLM (Ollama)
    ollama_base_url: str = "http://localhost:11434"
    llm_model: str = "qwen2.5:latest"
    # Optional dedicated code model for the Automation Agent (QA_LLM_CODER_MODEL).
    # When set and available in Ollama, automation generation uses it instead of
    # the per-project model; empty keeps the single-model behaviour.
    llm_coder_model: str = ""
    llm_temperature: float = 0.1
    llm_timeout_seconds: int = 300
    llm_max_retries: int = 2

    # Target application under test
    target_base_url: str = "http://localhost:8001"
    allowed_domains: str = "localhost,127.0.0.1"

    # Test credentials are referenced by env var NAME, never stored (FR-PROJ-004)
    test_username_env: str = "QA_TEST_USERNAME"
    test_password_env: str = "QA_TEST_PASSWORD"

    # GitHub integration (FR-GIT / FR-CI). Token read from GITHUB_TOKEN env only.
    github_repo: str = ""
    github_default_branch: str = "main"
    branch_prefix: str = "ai-tests"

    @property
    def allowed_domain_list(self) -> list[str]:
        return [d.strip() for d in self.allowed_domains.split(",") if d.strip()]

    @property
    def artifacts_path(self) -> Path:
        p = BASE_DIR / self.artifacts_dir
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def reports_path(self) -> Path:
        p = BASE_DIR / self.reports_dir
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def generated_tests_path(self) -> Path:
        p = BASE_DIR / self.generated_tests_dir
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
