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

## UI Scanner Agent (FR-UIS-*)

The **UI Scanner** tab on the Analysis page opens the application under test in a
real browser, discovers the elements that matter for automation, and produces a
Playwright locator for each one that has been *validated against the live page*.

```
Analysis page ─ UI Scanner tab ─▶ POST /projects/:id/ui-scans ─▶ engine /internal/v1/ui-scans
      ▲                                      │                            │ Playwright
      └── ui_scan.status / ui_scan.log (WS) ─┘◀─ SSE ordered events ──────┘
```

- **Deterministic first.** Candidates are generated in stability order — role +
  accessible name → label → test id → placeholder → scoped semantic → text →
  name → stable id → CSS → XPath — then each one is rebuilt through the
  Playwright API and probed against the page. Zero matches is invalid, a single
  match against a *different* element is rejected, and duplicates are resolved
  with a scoped locator (`getByRole('region', { name: 'Profile' })
  .getByRole('button', { name: 'Save' })`) rather than `.nth()`.
- **The model is a fallback, not the default.** The project's configured model
  is consulted only for elements deterministic generation could not resolve,
  receives compact sanitised metadata (never page HTML), and its suggestion is
  validated on the live page like any other candidate.
- **Locators are data, not code.** Every locator is stored twice: displayable
  Playwright code and a machine-readable `locatorData` structure. Only the
  structure is ever executed — nothing in this feature turns a stored string
  into behaviour.
- **Credentials are single-use.** The sign-in dialog's username and password are
  forwarded to the browser session for one scan and are never persisted, logged
  or sent to the model.

## Locator-bound automation generation (FR-UIS-025)

Saved locators are not a hint to the generator — they are its only source of
locators. Every UI test step is bound to a scanned locator *before* the model is
called, and the model's output is rejected if it contains any locator it was not
given.

```text
Generated test case → read each test step → identify the page and the element
  → search the project's scanned locator library → match step to element
  → take the best approved locator → revalidate it when stale
  → generate the Playwright step → record which locator was used
```

- **One fixed priority order.** Approved + recently validated → approved +
  revalidated on the live page → valid, unique, high-confidence but not yet
  approved → a targeted rescan → the model matching a step to an *already
  scanned* element → unresolved. A model-proposed selector never enters that
  ladder at all: the most the model can contribute is choosing between elements
  the scanner already validated.
- **Matching is deterministic first.** Page, frame, page state, role, accessible
  name, label, placeholder, input type, visible text, the containing
  form/dialog/region/row and the nearest heading decide which element a step
  means. Two elements that match equally well are reported as ambiguous, not
  resolved by `.nth()`.
- **Revalidation is targeted, not blanket.** A locator goes back to the browser
  when it has never been validated, has gone stale, failed on its last run, was
  hand-edited or sits below the confidence bar — and then one browser context
  serves every locator on that page, never one per step.
- **Unresolved steps are marked, never faked.** A step nothing covers produces
  `# LOCATOR_REVIEW_REQUIRED` in the code and a structured record in the API,
  and the generated suite is reported as *not* execution-ready.
- **Every generated interaction is traceable.** A row in
  `generated_step_locator_refs` links the Playwright line → test step → scanned
  element → locator record → version → scan, and the Automation page's Code tab
  shows the element, page, strategy, expression, source, both confidences,
  validation status, version and last-validated date.
- **Usage is measured.** Generation bumps each locator's usage count; a finished
  execution records success or failure against it — but only when the failure
  *is* the locator failing to resolve, never an application assertion, a timeout
  or bad test data.

```text
POST /projects/:projectId/locators/resolve         one test case (or ad-hoc steps)
POST /projects/:projectId/locators/resolve-batch   several test cases, one pass
POST /projects/:projectId/locators/revalidate      re-probe stored locators
GET  /projects/:projectId/locators/:locatorId      one locator record
GET  /projects/:projectId/locators/:locatorId/usage where it is used, how it ran
GET  /automation/:id/locator-references            what a generated file is bound to
```

## Run (local dev, no Docker required)

Prereqs: Node 22+/npm, Python 3.12+ venv, Ollama running (`ollama serve` + `ollama pull qwen2.5:latest`).

```bash
# 1. Engine (:8100)
.venv/bin/pip install -r engine/requirements.txt
# --reload matters in dev: without it the engine keeps serving the code it was
# started with, and edits appear to have no effect (or 404 on new routes).
ENGINE_TOKEN=dev-engine-token .venv/bin/python -m uvicorn engine.service.main:app --port 8100 --reload

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
- UI Scanner targets are SSRF-checked in the backend *and* the engine: only
  http/https, DNS resolved and every returned address checked against loopback,
  private, link-local, CGNAT, reserved and cloud-metadata ranges, with redirects
  re-checked mid-scan. A project's `allowedDomains` re-enables named internal
  hosts for local development.
- Scan credentials are request-scoped: never written to the database, never
  logged, never sent to the model. Password and hidden field *values* are
  dropped at capture; only role, label, placeholder and type are kept.
- Scan artefacts are served by scan id after a membership check, so no backend
  filesystem path is ever exposed to the browser.

---

## V1 (preserved)

The original single-service Python/FastAPI + LangGraph app remains fully functional and is now the basis of the engine tier. Its docs, pipeline and 159 passing unit tests are unchanged. See git history and `docs/AI_QA_Agent_Project_Requirements.docx` for the V1 SRS; `docs/AI_QA_Agent_Project_Requirements_V2.docx` (and the authoritative `docs/AI_QA_Agent_Project_Requirements_V3.docx`) define the current platform.
