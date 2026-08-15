# QA_AI_Agents Engine (V2)

Separately runnable Python engine exposing the versioned internal contract the
Node.js backend calls (FR-ENG-001..005). It wraps the V1 logic (`agents/`,
`tools/`, `app/`) — the engine is compute-only and never the system of record.

## Run

```bash
# from apps/qa-engine — uv creates/updates the shared .venv from uv.lock
uv sync --all-extras
ENGINE_TOKEN=dev-engine-token uv run python -m uvicorn engine.service.main:app --port 8100
```

Health: `GET http://localhost:8100/internal/v1/health` (no auth on health).
All other endpoints require header `X-Engine-Token: <ENGINE_TOKEN>`.

## Contract

See [`docs/V2_CONTRACT.md`](../../../docs/V2_CONTRACT.md) §4. Endpoints:
`/parse`, `/analyse`, `/test-plan`, `/test-cases`, `/automation`, `/validate`,
`/execution-plan`, `/classify`, `/report`, `/execute` (+ `/runs/{id}/events`
SSE), `/health`. Outputs are versioned Pydantic schemas (`engine/contracts/`).

## Live execution events (FR-EXE-006)

`/execute` runs pytest with the `engine.service.step_events` plugin and points
`QA_EVENT_SINK` at `/runs/{id}/_ingest`; page objects emit navigate/click/fill/
assert steps which are republished on the run's SSE stream. Values on
sensitive fields are redacted (SEC-007).
