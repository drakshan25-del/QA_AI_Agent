# Agentic AI Quality Assurance System

An MSc dissertation prototype that turns natural-language requirements into reviewable test assets and deterministic Playwright automation — with human oversight, auditability and CI/CD integration at every step.

**Pipeline:** requirements in (text / Markdown / PDF / DOCX / JSON) → AI analysis → test plan → test cases → Playwright/Pytest code → validation & safety gate → human approval → local execution → Git feature branch → GitHub Actions → failure classification → defect drafts → final test report.

**Core principle (SRS §6.3):** *AI proposes; deterministic tools validate and execute.* Generated code is treated as untrusted until syntax, import, collection and policy checks pass, and no commit, push, CI dispatch or issue creation happens without explicit human approval.

## Architecture

| Layer | Technology |
|---|---|
| Workflow orchestration | LangGraph (stateful graph, HITL interrupts, bounded retries) |
| Agents | LangChain + ChatOllama (local models, default `qwen2.5:latest`) |
| Browser automation | Playwright for Python (Chromium MVP), Page Object Model |
| Test runner | Pytest + pytest-playwright (JUnit XML, screenshots, traces) |
| API | FastAPI (`app/main.py`) |
| Persistence | SQLite via SQLAlchemy 2.0 (PostgreSQL-ready) |
| CI/CD | GitHub Actions (`.github/workflows/playwright-ci.yml`) — no Ollama dependency in CI (§12.3) |

## Repository layout

```
app/            FastAPI app: api/ routers, core/ (config, llm, security, logging), models/, services/
agents/         LLM agents: requirement, test plan, test case, automation, result analysis, report
graph/          LangGraph state, nodes and workflow wiring
tools/          Bounded deterministic tools: ingestion, validation, playwright execution, git, GitHub Actions
automation/     Page objects, fixtures, hand-written smoke tests, generated_tests/ (AI output lands here)
sample_app/     Demo target app with seedable defects for evaluation
tests/          unit / integration / e2e system tests
reports/        Generated test reports        artifacts/   Execution evidence (screenshots, traces, junit)
```

## Setup

```bash
# 1. Environment (Python 3.12+; repo venv already provisioned)
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# 2. Configuration
cp .env.example .env        # adjust values; never commit .env

# 3. Local LLM
ollama serve                # then: ollama pull qwen2.5:latest
```

## Running

```bash
# Demo target app (port 8001)
.venv/bin/python -m uvicorn sample_app.main:app --port 8001

# QA system API (port 8000) — interactive docs at /docs
.venv/bin/python -m uvicorn app.main:app --port 8000

# End-to-end demo through the LangGraph workflow (pauses for approvals)
.venv/bin/python scripts/demo.py
```

Typical API flow (§14.2): `POST /projects` → `POST /projects/{id}/requirements` (or `/upload`) → `POST /requirements/{id}/analyse` → `POST /projects/{id}/test-plan` → `POST /requirements/{id}/test-cases` → approve cases → `POST /test-cases/automation` → `POST /artifacts/{id}/approve` → `POST /executions` → `POST /results/{id}/classify` → `POST /findings/{id}/defect-draft` → `POST /reports/execution/{run_id}`.

## Tests

```bash
.venv/bin/python -m pytest tests/unit -q          # fast, no external services
.venv/bin/python -m pytest -q                     # full suite; browser/LLM tests skip when services are absent
.venv/bin/python -m pytest -m smoke               # smoke suite against the sample app
```

Seeded defects for evaluation (§15.2): start the sample app with e.g. `SAMPLE_APP_DEFECTS=login_message` to inject known bugs (`login_message`, `duplicate_add`, `delete_noop`) and measure the generated suite's defect detection rate.

## Security & governance (SRS §13)

- Secrets only via environment variables / GitHub Secrets; logs and reports are redacted (SEC-002/007).
- Browser navigation restricted to the project domain allow-list (SEC-003).
- The LLM never gets shell access or credentials; it only proposes artefacts that pass a validation gate scanning for forbidden operations, hard-coded secrets, disallowed domains, fragile locators and static sleeps (SEC-005, FR-VAL-001..005).
- Uploaded documents and page content are treated as data, not instructions (prompt-injection guard, §13.1).
- Every agent run, approval, git and CI action is written to the audit log (FR-AUD-001).

## Research evaluation

Generation runs record model, prompt version, parameters and input/output hashes (NFR-EXP-001) so experiments are reproducible. Metrics per §15.2 — test-case validity, requirements coverage, execution success, seeded-defect detection, false-positive rate, classification accuracy — can be exported from the database for analysis against a manual QA baseline.

---
*Software Requirements Specification: `docs/AI_QA_Agent_Project_Requirements.docx` (v1.0, 16 July 2026). Author: Rakshan Dangol.*
