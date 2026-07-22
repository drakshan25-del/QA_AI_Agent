# Agentic AI Quality Assurance System — V2

A web-based platform that turns uploaded project documents (User Stories, Epics, SRS, API docs, architecture — in **Word, PDF, Excel**, plus text/Markdown/JSON) into traceable, reviewable test assets and deterministic Playwright automation, with human approval gates, **live browser-execution visualisation**, failure classification and web reports.

**Core principle (SRS §6.3):** *AI proposes; deterministic tools validate and execute.* Generated code is untrusted until syntax, policy and test checks pass; no commit, push, CI dispatch or issue creation happens without explicit human approval.

## V2 three-tier architecture

```
React (Vite, :5173)  ──REST /api/v2/* + WS /api/v2/events──▶  NestJS backend (:4000)
                                                                 │  TypeORM → PostgreSQL :5432 (SQLite dev fallback)
                                                                 │  HTTP /internal/v1/* + SSE
                                                                 ▼
                                                    QA_AI_Agents engine (FastAPI :8100)
                                                                 │  Ollama :11434 · Playwright · git/gh
```

| Tier | Tech | Responsibility |
|---|---|---|
| **Frontend** (`frontend/`) | React 18 + Vite + TypeScript | Upload, source preview, plan/case review, code viewer + diff, approvals, **live execution timeline**, reports, audit (FR-FE-*) |
| **Backend** (`backend/`) | NestJS + TypeORM | Auth/roles, projects, documents, approvals, jobs, executions, GitHub/CI, WebSocket events, audit — the system of record (FR-BE-*) |
| **Engine** (`engine/`) | Python FastAPI wrapping V1 logic | Parse docs, LangGraph/create_agent/ChatOllama generation, validation, Playwright execution with step events, classification, reporting (FR-ENG-*) |
| **Database** | PostgreSQL (SQLite dev fallback) | Projects, documents/segments, artefacts, approvals, runs, events, audit (§10.1) |
| **Real-time** | WebSocket/SSE | Step-by-step execution events to the browser (FR-EXE-006..008) |
| **CI/CD** | GitHub Actions | Validate + run committed tests; no Ollama in CI (§12.3) |

The V1 engine logic (`app/`, `agents/`, `graph/`, `tools/`, `automation/`, `sample_app/`) is **preserved and reused** by the engine tier. The integration contract every tier is built against is [`docs/V2_CONTRACT.md`](docs/V2_CONTRACT.md).

## Run (local dev, no Docker required)

Prereqs: Node 22+/npm, Python 3.12+ venv, Ollama running (`ollama serve` + `ollama pull qwen2.5:latest`).

```bash
# 1. Engine (:8100)
.venv/bin/pip install -r engine/requirements.txt
ENGINE_TOKEN=dev-engine-token .venv/bin/python -m uvicorn engine.service.main:app --port 8100

# 2. Backend (:4000) — SQLite dev fallback (no Postgres/Docker needed)
cd backend && npm install && \
  DB_DRIVER=sqlite JWT_ACCESS_SECRET=dev JWT_REFRESH_SECRET=dev \
  ENGINE_URL=http://localhost:8100 ENGINE_TOKEN=dev-engine-token \
  SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=admin12345 npm run start

# 3. Frontend (:5173)
cd frontend && npm install && npm run dev
```

## Run (docker-compose, PostgreSQL)

```bash
cp .env.v2.example .env      # set secrets
docker compose up --build    # postgres + redis + engine + backend + frontend
```

## Full stack (all tiers, per SRS §16)

Open http://localhost:5173, sign in with the seeded admin, create a project, upload documents, and drive the workflow through the approval gates to a live-visualised execution and report.

## Quality gates & tests

```bash
# Python engine + V1 logic (162 tests)
.venv/bin/python -m pytest tests/unit -q

# Backend: build, unit tests, lint
cd backend && npm run build && npm test && npm run lint

# Frontend: types, unit tests, lint, production build
cd frontend && npm run typecheck && npm test && npm run lint && npm run build
```

## CI (GitHub Actions, SRS §12)

`.github/workflows/playwright-ci.yml` runs two suites:

- **smoke** — always; targets the bundled `sample_app` started inside the runner.
- **generated** — only when the repository defines the `QA_TARGET_BASE_URL`
  (and optional `QA_ALLOWED_DOMAINS`) **variables** plus `QA_TEST_USERNAME` /
  `QA_TEST_PASSWORD` **secrets**; these AI-generated tests target the
  configured staging environment, never the sample app.

Reports (JUnit + self-contained HTML), screenshots and traces upload as the
`test-results` artifact on every run, pass or fail (§12.2).

## Security posture (SEC-*, §13)

- Self-registration can never grant a privileged role (admin/qa_lead/supervisor/devops).
- Every project/run WebSocket subscription is authorised against project membership.
- Generated code is statically gated (imports, dynamic-code builtins, filesystem
  mutation, domain allow-list, secrets) **before** pytest collection ever imports it,
  and browser traffic is runtime-restricted to allow-listed domains.
- Engine token comparisons are constant-time; tokens travel only in headers.
- Secrets are masked in logs, step events and reports.

---

## V1 (preserved)

The original single-service Python/FastAPI + LangGraph app remains fully functional and is now the basis of the engine tier. Its docs, pipeline and 159 passing unit tests are unchanged. See git history and `docs/AI_QA_Agent_Project_Requirements.docx` for the V1 SRS; `docs/AI_QA_Agent_Project_Requirements_V2.docx` (and the authoritative `docs/AI_QA_Agent_Project_Requirements_V3.docx`) define the current platform.
