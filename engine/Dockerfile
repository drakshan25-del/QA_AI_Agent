# QA_AI_Agents engine (Python + Playwright). Built from the repo root context.
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
ENV UV_LINK_MODE=copy

# Dependency layer: resolved from the committed lockfile, cached until it changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev --extra execution \
    && /app/.venv/bin/python -m playwright install --with-deps chromium

# Reused V1 packages + the engine service.
COPY app ./app
COPY agents ./agents
COPY tools ./tools
COPY automation ./automation
COPY sample_app ./sample_app
COPY engine ./engine
RUN uv sync --frozen --no-dev --extra execution

ENV ENGINE_PORT=8100
EXPOSE 8100
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "engine.service.main:app", "--host", "0.0.0.0", "--port", "8100"]
