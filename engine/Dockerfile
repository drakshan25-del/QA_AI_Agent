# QA_AI_Agents engine (Python + Playwright). Built from the repo root context.
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy

WORKDIR /app
COPY requirements.txt ./requirements.txt
COPY engine/requirements.txt ./engine/requirements.txt
RUN pip install --no-cache-dir -r engine/requirements.txt \
    && python -m playwright install --with-deps chromium

# Reused V1 packages + the engine service.
COPY app ./app
COPY agents ./agents
COPY graph ./graph
COPY tools ./tools
COPY automation ./automation
COPY sample_app ./sample_app
COPY engine ./engine
COPY pytest.ini ./pytest.ini

ENV ENGINE_PORT=8100
EXPOSE 8100
CMD ["python", "-m", "uvicorn", "engine.service.main:app", "--host", "0.0.0.0", "--port", "8100"]
