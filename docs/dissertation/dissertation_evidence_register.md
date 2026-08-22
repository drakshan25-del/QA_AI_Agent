# Dissertation Evidence Register — v1 (Phase 1 audit)

Project: **AI Quality Assurance Agent for SaaS Applications: UI, API, Regression and CI/CD Testing** (provisional title)
Repository: `QA_AI_Agent` (remote `github.com/drakshan25-del/QA_AI_Agent`)
Audit date: 2026-08-22
Audited state: branch `main`, HEAD `f3d3ab17` ("Merge pull request #1 from drakshan25-del/feature/UI-API-Regression", 2026-08-15), working tree clean.

This register records what the repository actually contains, with file-level evidence. It is the source of truth for every claim the dissertation will make. Nothing here may be cited in a chapter unless its Status is CONFIRMED.

---

## 1. Project timeline (from git history, all branches)

| Date (2026) | Commit | Event |
|---|---|---|
| 16 Jul | `5eac5d9b` "Final Dissertation Project" | Initial commit: V1 single-service Python/FastAPI + LangGraph app, agents, automation framework, sample app, CI workflow |
| 17 Jul | `e2f19cee`, `3e941272` | V2 then V3 requirements updates |
| 22 Jul | `65806ada`…`a8ceed47` | Execution bug fixes; automation execution logs |
| 25 Jul | `1aaf8c96` (branch `feature/llm-evaluation`, unmerged) | Pre-trained LLM comparison framework + `eval_results.sqlite` |
| 5 Aug | `6924169c` (branch `feature/UI-Scanner-locators`, unmerged) | UI Scanner + locator library (126 files, ~26k insertions) + `System_Architecture.docx` |
| 6 Aug | `a92d35cd`…`3474ff3c` | uv migration; monorepo move to `apps/` layout |
| 8 Aug | `a23b4250` (branch `feature/model-fine-tuning`, merged into main) | QLoRA fine-tuning of `qwen2.5-qa:latest` and `qwen2.5-coder-qa:7b` completed |
| 12–13 Aug | `652e58c3`…`0d55d991` | API test generation, regression comparison service, CI regression gate, frontend controls |
| 15 Aug | `5f9a6022` "completed whole feature mvp" | Final feature commit — **incidentally deletes `.github/workflows/playwright-ci.yml` (200 lines) from main** |
| 15 Aug | `f3d3ab17` | PR #1 merge to main (current HEAD) |

Branch status:
- `feature/model-fine-tuning` — fully merged into main (`git rev-list --count main..` = 0).
- `feature/llm-evaluation` — **unmerged**; sole home of the evaluation framework and `eval_results.sqlite`.
- `feature/UI-Scanner-locators` — **unmerged**; sole home of the UI Scanner / locator library and `System_Architecture.docx`.
- `feature/UI-API-Regression` / `ai-tests/ui-api-regression` — merged via PR #1.

---

## 2. Confirmed architecture and technology stack

Three-tier platform + demo target (all CONFIRMED from source):

| Tier | Path | Stack | Port |
|---|---|---|---|
| Frontend | `apps/frontend/` | React 18.3, Vite 7, TypeScript 5.6 (strict), TanStack Query 5, react-router 6, socket.io-client, axios, prismjs; bespoke CSS-Modules UI kit; Vitest | 5173 |
| Backend (system of record) | `apps/backend/` | NestJS 10.4, TypeORM 0.3 (PostgreSQL 16 / better-sqlite3 dev fallback, `synchronize: true`, no migrations), Passport-JWT, socket.io 4.8, bcryptjs, Swagger; Jest | 4000 |
| Engine (stateless compute) | `apps/qa-engine/` | Python 3.12, FastAPI, LangChain `ChatOllama` + `ChatOpenAI` (cloud), LangGraph 1.x (demo-only), Playwright + pytest, uv/pyproject | 8100 |
| Demo target | `apps/qa-engine/sample_app/` | FastAPI, in-memory store, seeded-defect flags | 8001 |
| Model host | Ollama on host (never in CI/containers) | `qwen2.5:latest` default; per-project cloud providers (OpenAI, Anthropic, OpenRouter, Groq, custom OpenAI-compatible) | 11434 |

Protocols: browser→backend REST `/api/v2/*` + socket.io on `/api/v2/events`; backend→engine HTTP `/internal/v1/*` with `X-Engine-Token` (constant-time), `Idempotency-Key`, `X-Correlation-Id`; engine→backend SSE `/runs/{id}/events` replayable by `from_seq`; pytest child → engine loopback `_ingest`. Contract pinned in `docs/V2_CONTRACT.md` and `engine/contracts/schemas.py` (`SCHEMA_VERSION = "v1"`).

Key architecture invariant (SRS §6.3, README:5): *"AI proposes; deterministic tools validate and execute."*

---

## 3. Confirmed implemented functionality (main, HEAD f3d3ab17)

All items verified in source by the audit; file references are the primary evidence anchors.

### Pipeline
- **Document ingestion**: `.txt .md .json .pdf .docx` via `tools/file_ingestion.py` (10 MB cap, scanned-PDF rejection, per-chunk location traceability); `.xlsx/.xls` via `engine/parsers/excel.py` (per-row provenance). Upload validation incl. macro-bearing file rejection: `apps/backend/src/modules/documents/file-validation.ts`.
- **Requirement analysis**: `agents/requirement_agent.py` (actors/flows/rules, ambiguity issues, 1–9 risk score).
- **Test-plan generation**: `agents/test_plan_agent.py` (10-section plan, structured output, markdown renderer); revisions/compare/restore in `apps/backend/src/modules/test-plans/`.
- **Test-case generation**: `agents/test_case_agent.py` (normalisation invariants, difflib duplicate detection at 0.85, coverage report); stable `TC-n` IDs via CAS sequence allocator (`apps/backend/src/modules/sequences/`).
- **Automation generation** (`agents/automation_agent.py`, 1,664 lines): UI + API prompt pairs with worked examples; `testType ∈ {ui, api}`; regression handled as deterministic marker algebra (`docs/V2_CONTRACT.md` §3); retry-with-feedback loop (rejection text fed back; temperature escalation `min(0.9, base + 0.25·attempt)`).
- **Generation grounding**: DOM grounding via `agents/page_inspector.py` (HTTP + stdlib HTMLParser distillation, same-origin lock, auth-gated page login probe — *not* a browser; SPA pages fall back ungrounded); OpenAPI grounding via `agents/api_inspector.py` (fail-open).
- **In-loop generation gates** (12): AST parse, no fixed waits, imports resolve, page-object API exists, literal locators exist on observed page, page paths exist, API style, documented endpoints, documented payloads, element-kind action contract, reserved-file drop, path dedupe (`agents/automation_agent.py`).
- **Deterministic security validation gate**: `tools/code_validation.py` + `app/services/validation.py` — forbidden modules/calls/builtins/method mutators, sandboxed write roots, secrets patterns, domain allow-list, locator policy, sleep ban, fixture contract; collection check runs *after* static checks in a temp mirror (ordering is a documented security property); regex fallback for unparseable source; runnable self-check at `app/services/validation.py:204-259`.
- **Approval gates + cascade invalidation**: `apps/backend/src/modules/approvals/approvals.service.ts` (`ensureApproved` 409; `onUpstreamModified` version-bound invalidation cascade); enforcement points in automation/executions/git/ci/reports services.
- **Execution**: `engine/service/execution.py` (pytest+Playwright subprocess in own process group; SIGTERM→SIGKILL; materialise-ownership guard `.materialised.json`; framework preflight fail-fast; three timeout layers with backend watchdog); step telemetry `engine/service/step_events.py` (bounded queue, daemon sender, secret redaction) → `engine/service/eventbus.py` (ordered, replayable, bounded) → SSE → backend persistence → WebSocket fan-out.
- **Live visualisation**: `apps/frontend/src/features/executions/` (pure timeline reducer with seq dedup — unit tested; replay + reconnect gap-fill; plain-language step labels; log console; evidence panel).
- **Failure classification**: deterministic regex heuristics + LLM (`agents/result_analysis_agent.py`); human override + defect draft API (`apps/backend/src/modules/findings/`; defect-draft has **no UI surface**).
- **Reporting**: `app/services/report_service.py` (Jinja2 autoescaped HTML, measured-vs-AI-narrative labelling, no-LLM fallback narrative); exports PDF (engine headless Chromium) / HTML / JSON / JUnit / CSV; publication approval gate.
- **Regression testing**: baseline promotion (single-baseline invariant), stateless comparison `app/services/regression.py` (`compare_runs`: regressions/fixes/still_failing/new/missing/skipped/stable; `has_regressions` gate boolean); backend module + frontend page; CI gate `scripts/regression_gate.py` (exit 0/1, missing baseline tolerated).
- **Git/CI**: local approved-artefact commit + real non-force GitHub push with path-containment and `.git`-segment defence, token redaction, no token in `.git/config` (`apps/backend/src/modules/git/git.service.ts`); GitHub Actions `workflow_dispatch` + result import (`apps/backend/src/modules/ci/`); engine-side `tools/git_tools.py` (protected branches, approval-gated push), `tools/github_actions.py` (REST, token never through API layer).
- **CI pipeline definition**: 200-line five-suite workflow (smoke / ui / api / regression + gate / staging) — **history-only**, read via `git show 5f9a6022^:.github/workflows/playwright-ci.yml`.

### Platform
- Auth (JWT 15 min access + HTTP-only 7-day refresh cookie, single-flight refresh in frontend), roles incl. superowner carve-out, self-registration restricted to non-privileged roles, seeded admin; RBAC permission matrix (`apps/backend/src/common/access/permissions.ts`).
- Per-project LLM config LOCAL (Ollama) / CLOUD (OpenAI, Anthropic, OpenRouter, Groq, custom) with AES-256-GCM key sealing (`apps/backend/src/common/llm/`); engine-side runtime routing via ContextVar (`app/core/llm.py`), incl. documented cloud workarounds (function-calling structured output; temperature-400 retry).
- Jobs subsystem (async 202 + state machine + live logs + cooperative cancel + retry lineage); executions queue (`EXEC_MAX_CONCURRENT`); four state machines as literal transition maps (`apps/backend/src/common/state-machines.ts`; `outcomeFromMetrics` never reports green from empty metrics).
- Audit trail (append-only), notifications, retention sweeps, correlation-ID tracing end to end.
- Security: prompt-injection guards in every agent prompt + delimiter wrapping; dual-layer domain allow-list (static gate + Playwright route abort + httpx hook — `automation/conftest.py`); secret redaction in logs/steps/reports; WS auth with token never in query string.

### Automation assets
- Hand-written: `automation/tests/test_smoke_sample_app.py` (3 smoke tests; explicit reference style), `automation/pages/base_page.py` (instrumented).
- AI-generated: 21 test modules in `automation/generated_tests/` (all `pytest.mark.generated`; `# TC:`/`# REQ:` headers; suite split ui 8 / api 5 / regression-api 3 / regression-ui 2 / marker-less legacy 3) + 13+ generated page objects (`.materialised.json` sha256 provenance). Known generated-code defects are catalogued in §7 below.
- Sample app: 5 epics / 21 user stories (`sample_app/USER_STORIES.md`); selector + JSON-API contracts in `sample_app/main.py` docstring; **three seeded defects** toggled by `SAMPLE_APP_DEFECTS` (`login_message`, `duplicate_add`, `delete_noop`) — ground truth for defect-detection measurement (SRS §15.2/§16).

### Tests (as-of HEAD; static counts)
- Engine/Python: 24 unit files + 1 live-Ollama integration file, ≈361 unit test functions (68 of them test the sample app). Honest invocation: `pytest tests/ -m unit`.
- Backend: 10 Jest spec files (64 cases) + 2 supertest e2e files (7 cases, in-memory SQLite).
- Frontend: 6 Vitest files (35 cases).
- Empty: `tests/e2e/` (engine), no frontend E2E, no coverage thresholds anywhere.

---

## 4. Branch-only functionality (NOT on main — must be reported as such)

### 4.1 UI Scanner and locator library — `feature/UI-Scanner-locators` (unmerged, pre-monorepo layout)
126 files changed / ~26,048 insertions vs its base `a8ceed47`. Full-stack: backend `ui-scanner` + `locator-resolution` modules, 5 entities (`ui-scan`, `scanned-element`, `locator-record`, `step-locator-reference`, `ui-scan-log-entry`), engine `agents/locator_match_agent.py`, frontend `features/ui-scanner/` (11 components) + `LocatorTraceabilityPanel`, unit tests (`test_ui_scanner_crawl.py`, `test_ui_scanner_locators.py` 357 lines, `test_ui_scanner_url_guard.py`). Design (branch README): deterministic locator candidate ladder (role+name → label → testid → placeholder → scoped semantic → text → name → stable id → CSS → XPath), live-page probing, ambiguity rejected rather than `.nth()`, model as fallback only, targeted revalidation, `# LOCATOR_REVIEW_REQUIRED` for unresolved steps, SSRF checks both tiers, request-scoped scan credentials.
Runtime residue on main machine: `apps/backend/evidence/ui-scans/` (12 scans: screenshot.png + accessibility-snapshot.yaml of public demo apps OrangeHRM / practicetestautomation.com) — orphaned; no code on main produces it.

### 4.2 LLM evaluation framework — `feature/llm-evaluation` (unmerged, pre-monorepo layout)
- Registry: `qwen2.5:latest`, `qwen2.5-coder:latest`, `deepseek-r1:8b`; judge `qwen3.5:397b-cloud` (held out to avoid self-preference); embeddings `nomic-embed-text:latest`.
- Design: 6 YAML benchmark items; tasks test_plan/test_cases/automation; 3 repetitions; temperature 0.1; non-invasive model injection with token capture.
- 13 metric modules: deterministic accuracy, completeness, requirement coverage, consistency (structural+embedding+stability), hallucination (AST + judge, severity-weighted), executability, code quality (static+judge blend), explainability, reliability, robustness, speed, satisfaction (SUS instrument), judge. Rubric weights in `evaluation/metrics/rubric.py` (`RESEARCH_SCORE_WEIGHTS`).
- Results: `eval_results.sqlite` (272 KB, committed on the branch) — 3 batches on 2026-07-25; ~59 runs (qwen2.5 39, qwen2.5-coder 18, deepseek-r1 2).
- **Caveats (CONFIRMED)**: judge never executed (no judgement rows); raw output files referenced by `runs.raw_path` absent; no CSV/JSON exports generated; dashboard never screenshotted; SUS empty; `run_execution=False` (executability = build/collection only); deepseek effectively unevaluated; fine-tuned models never added to the registry.

---

## 5. Fine-tuning research strand (merged; tracked code + untracked local artefacts)

- Method (`apps/qa-engine/finetune/`): fully synthetic deterministic corpus — 8 fictional apps / 27 features (`seeds.py`), gold labels rendered from the same specs (`gold.py`), rendered through the *production* agent prompts (`build_dataset.py`), hard label-validation gates, seeded splits (`random.Random(20260808)`).
- Datasets (untracked, on disk): planner 54 train / 8 valid; coder 43 train / 6 valid; held-out Beacon Helpdesk eval sets (8 + 6; their valid.jsonl deliberately empty). Held-out JSONL never consumed (eval.py regenerates prompts live).
- Training: MLX QLoRA on `mlx-community/Qwen2.5-7B-Instruct-4bit` and `Qwen2.5-Coder-7B-Instruct-4bit`; rank 16, dropout 0.05, scale 20, last 16 layers, batch 1, lr 5e-5 constant, 5 epochs (270 / 215 iters), mask_prompt, grad checkpoint, seed 20260808. Trainable parameters 0.303 % (23.07 M / 7,615.6 M). Peak memory 13.3 / 16.6 GB. ~1–2 h per model on an M-series Mac (file mtimes: ~64 min planner, ~84 min coder, 8 Aug). Hardware model NOT recorded anywhere.
- Loss (from `work/*_train.log`): planner val 0.470 → 0.003 (final best). **Coder val minimised at iter 43 (0.026, one epoch) and rises to 0.054 by final iter 215 — the exported model is the overfit final checkpoint** (earlier checkpoints exist on disk, never re-exported).
- Export: fuse → GGUF f16 → Q4_K_M (14,526 MiB @16 BPW → 4,460 MiB @4.91 BPW) → `ollama create`. Planner export log ends in an `unbound variable` failure; the successful re-run was not logged (model demonstrably exists).
- Before/after eval (`finetune/eval.py`, `work/eval_report.json`, n=1 per cell, held-out app, real agents): planner fine-tune ↑ case counts and justified plan-type count (2→5), category count mixed (kb_search 7→3); coder fine-tune ↑ compiles 1/3→2/3, pytestmark 0/3→3/3, page objects 0/3→3/3, latency ×3 (15 s→48 s).
- **Contradicting operational evidence**: `run-headed.sh:30-33` deliberately defaults the coder back to base `qwen2.5-coder:7b` — comment states the fine-tune "hallucinates page-object methods and emits unparseable files often enough to exhaust the generation retry budget" — while `docker-compose.yml:30` defaults to the fine-tune. Both facts must be reported.

---

## 6. Available results and primary data (evidence inventory)

| Evidence | Location | Tracked? | Notes |
|---|---|---|---|
| 107 execution-run artefact dirs (105 junit.xml + pytest.log + test-output/) | `apps/qa-engine/artifacts/<uuid>/` | untracked | All `hostname="Rakshans-MacBook-Pro.local"` — local runs, none from CI |
| Pre-trained comparison DB | `feature/llm-evaluation:eval_results.sqlite` | tracked (branch) | Needs `evaluation.cli export` run on the branch to produce tables |
| Fine-tune training logs, adapters (×6 ckpts each), GGUFs, Modelfiles, eval_report.json, eval.log | `apps/qa-engine/finetune/work/` | untracked | Sole copies; ~9.4 GB incl. GGUFs |
| Fine-tune datasets (JSONL) | `apps/qa-engine/finetune/data/` | untracked | Sole copies |
| V2 dev database (7 evaluation-era projects incl. deepseek/qwen3 comparisons) | `apps/backend/qa_v2.dev.sqlite` | untracked | Aug 6 state; pre-fine-tune |
| Current project data (per-model projects incl. `claude-sonnet-5`, `qwen2.5-coder-qa:7b`, pretrained-vs-finetune projects seen in preflight) | PostgreSQL `pgdata` docker volume | volume | Needs export |
| V1 database | `apps/qa-engine/qa_agents.db` | untracked | 26 Jul |
| Uploaded requirement docs (synthetic xlsx) + real push workspace with 2 commits | `apps/backend/evidence/` | untracked (gitignored) | git-push workspace proves token-hygiene claim (`.git/config` has no url) |
| Preflight log (5-phase demo verification, 15 Aug) | `logs/preflight.log` | untracked | Shows cloud `claude-sonnet-4-5`/`claude-sonnet-5` projects; 1 failing suite |
| System architecture document (reverse-engineered, with Mermaid figures, at `a8ceed47`) | `feature/UI-Scanner-locators:System_Architecture.docx` | tracked (branch) | Describes pre-monorepo state; some observations now stale (e.g. Redis no longer in compose) |
| Test execution module guide (22 Jul) | `docs/Test_Execution_Module_Explained.docx` | tracked | Header contains work email — anonymise before appendix use |
| Integration contract | `docs/V2_CONTRACT.md` | tracked | Authoritative |
| CI workflow (definitive 200-line version) | `git show 5f9a6022^:.github/workflows/playwright-ci.yml` | history only | Deleted from main by `5f9a6022` |

---

## 7. Gaps, contradictions and risks (all CONFIRMED)

1. **CI absent from main**: `5f9a6022` deleted the workflow (200 deletions, no rationale); README:78-97 and `docs/V2_CONTRACT.md:164` still describe it as live. No GitHub Actions run evidence exists in-repo; capture `gh run list` / screenshots before artifact retention expires.
2. **Regression gate never invoked on any branch tip** — `scripts/regression_gate.py` is on main but only history-version CI called it.
3. **Fine-tune contradiction**: compose defaults to the fine-tuned coder; `run-headed.sh` deliberately reverts with a documented hallucination complaint; eval_report.json is positive but n=1. The coder export used the overfit final checkpoint (best-val ckpt unexported).
4. **Two evaluation strands never linked**: fine-tuned models absent from the branch framework's registry; branch framework's judge/SUS/robustness/execution metrics never ran; raw outputs missing; deepseek-r1 has only 2 runs.
5. **UI Scanner unmerged** — describing it as part of "the system" without branch qualification would be an unsupported claim.
6. **LangGraph orchestration is demo-only** (`scripts/demo.py`); production orchestration is imperative in the backend. README's "LangGraph/create_agent/ChatOllama generation" phrasing overstates; no `create_agent` use exists.
7. **Generated-suite defects** (evidence for honest evaluation, not concealment): `test_login_redirects.py` 60 s `wait_for_timeout` + hard-coded credentials (gate miss); `test_transaction_page.py` missing `expect` import + malformed selector + always-true skip masking both + nonexistent route; `test_user_management.py` misuses `SampleItemsPage`; 3 marker-less legacy files would fall into the *staging* CI suite against a real environment.
8. **Documentation drift**: README "159 passing unit tests" vs ≈361 now; frontend README claims react-syntax-highlighter (absent), 2 test files (6 exist), stale route list and `CodeViewer` name; backend README stale on push ("no network push" — real push exists), docx export (nonexistent; silently falls back), CI simulation (removed); Swagger `qa.yml` vs actual `playwright-ci.yml` default.
9. **SRS documents missing from repo**: `docs/AI_QA_Agent_Project_Requirements{,_V2,_V3}.docx` referenced in README §V1 but never committed on any branch. FR-*/SEC-*/§-references throughout code cite them.
10. **Confidentiality/PII (act before submission)**: committed `.env.example` / `.env.v2.example` contain real-looking secrets (flagged inside `System_Architecture.docx` §13 itself); hard-coded personal Gmail as `SUPEROWNER_EMAIL` default (`apps/backend/src/config/configuration.ts:82`, `test/auth.e2e-spec.ts:69`); employer name "Keepme" in `apps/qa-engine/.env.example` (committed), `automation/pages/keepme_login_page.py`, three artifact run dirs, and branch-only uploaded `Keepme_*.docx` evidence files; work email `rakshan@keepme.ai` in `docs/Test_Execution_Module_Explained.docx`; dev default admin credentials inlined in compose/scripts.
11. **No LICENSE file** in the repo; base-model licences (Qwen Apache-2.0 derivatives) not recorded.
12. **Hardware spec for fine-tuning not recorded** — only "M-series Mac, 16 GB" inferable.
13. Engine risks acknowledged in code/docs: process-local event bus/idempotency (no horizontal scale), unbounded `/execute` concurrency, dev-token fallback, HTML-only page scanning (SPA limitation), fail-open literal-locator gate.

---

## 8. Candidate figures, tables and appendix extracts (shortlist; full lists in section reports)

Figures (diagrams to be drawn only from confirmed architecture):
- F-A Container architecture (3 tiers + sample app + Ollama; trust boundaries) — from README:9-16, `docs/V2_CONTRACT.md`, compose.
- F-B Pipeline with approval gates + invalidation cascade — `graph/workflow.py` docstring, `approvals.service.ts`.
- F-C Live telemetry path (base_page → step_events → eventbus → SSE → DB/WS → reducer) — engine + frontend files.
- F-D State machines (job, execution, validation, artefact lifecycle) — `state-machines.ts`.
- F-E Validation gate ordering (static → collection-in-mirror) — `app/services/validation.py`.
- F-F Marker algebra + CI suites — `docs/V2_CONTRACT.md` §3.
- F-G QLoRA loss curves (planner vs coder; coder overfit) — `finetune/work/*_train.log`.
- F-H Locator candidate ladder (branch-qualified) — UI-Scanner branch README.
- Screenshots: live execution timeline, automation review tabs, regression comparison page, approvals inbox, audit trail, report page, upload centre, project overview (12-item list in frontend report).

Tables:
- T-1 Role × permission matrix (`permissions.ts`).
- T-2 Engine endpoint inventory (`engine/service/main.py`).
- T-3 Generated-suite composition (21 files × markers × TC ranges).
- T-4 Fine-tune configs (yaml + adapter_config.json).
- T-5 Before/after fine-tune results (`eval_report.json`) with n=1 caveat.
- T-6 Evaluation rubric weights (`rubric.py`, branch).
- T-7 Seeded defects × detecting tests (sample_app).
- T-8 Quantisation/deployment figures (export logs).

Appendices: CI YAML (history version, branch-qualified); UI+API codegen system prompts; forbidden-construct tables; regression compare service + gate; conftest dual-layer domain guard; sample generated tests (one good UI, one good API, one defective with analysis); `.manifest.json` provenance; sample junit.xml failure (strict-mode violation, run `2a55a04f…`); USER_STORIES extract; dataset JSONL record; Modelfile; `.env` key inventory (values stripped).

---

## 9. Traceability: dissertation claim → evidence (v1)

See the Phase 1 audit message (2026-08-22) for the presented table; this register holds the master copy.

| # | Proposed claim | Evidence | Status |
|---|---|---|---|
| C1 | Three-tier agentic QA platform implemented (React/NestJS/FastAPI) | `apps/*`; `docs/V2_CONTRACT.md`; `docker-compose.yml` | CONFIRMED |
| C2 | Documents (Word/PDF/Excel/text/MD/JSON) parsed into traceable segments | `tools/file_ingestion.py`; `engine/parsers/excel.py`; `documents` module | CONFIRMED |
| C3 | LLM agents generate analysis, plans, cases, automation with structured output | `agents/*.py`; `app/models/schemas.py` | CONFIRMED |
| C4 | Generation grounded in live DOM and OpenAPI surface | `agents/page_inspector.py`; `agents/api_inspector.py`; preflight log §3 | CONFIRMED (automation stage only; HTML-only scanning) |
| C5 | Generated code passes deterministic security gates before execution | `tools/code_validation.py`; `app/services/validation.py` | CONFIRMED |
| C6 | Human approval gates all irreversible actions; edits invalidate downstream approvals | `approvals.service.ts`; enforcement sites in executions/git/ci/reports | CONFIRMED |
| C7 | Live browser execution visualised step-by-step with replay | engine step_events/eventbus/SSE + frontend timeline reducer (+8 unit tests) | CONFIRMED |
| C8 | UI, API and regression suites generated and marker-selected | `automation/generated_tests/` (21 files); V2_CONTRACT §3; `automation.service.spec.ts` | CONFIRMED |
| C9 | Regression baseline/comparison service with CI gate | `app/services/regression.py`; `scripts/regression_gate.py`; regression module/page | CONFIRMED (gate wired only in history CI) |
| C10 | Five-suite GitHub Actions pipeline with regression gate designed | `git show 5f9a6022^:.github/workflows/playwright-ci.yml` | CONFIRMED as design; **no execution evidence; absent from main** |
| C11 | CI pipeline executed on GitHub Actions | — | EVIDENCE REQUIRED (gh run list / screenshots) |
| C12 | Approved code committed and pushed to GitHub without leaking tokens | `git.service.ts` + 15 tests; `evidence/git-push/` workspace | CONFIRMED |
| C13 | Local (Ollama) and cloud (OpenAI/Anthropic/OpenRouter/Groq) LLMs selectable per project | `providers.ts`; `app/core/llm.py`; `ProjectForm` + 11 tests; preflight log (claude-sonnet projects) | CONFIRMED |
| C14 | Three pre-trained LLMs compared on a 13-metric rubric | branch `feature/llm-evaluation`: framework + `eval_results.sqlite` | PARTIAL — deepseek n=2; judge/SUS/execution metrics never ran; raw outputs missing |
| C15 | Two 7B models fine-tuned with QLoRA on a synthetic self-authored dataset | `finetune/` code + configs + `work/` logs/adapters/GGUFs | CONFIRMED (hardware spec unrecorded) |
| C16 | Fine-tuning improved planner/coder outputs on held-out app | `work/eval_report.json` | PARTIAL — n=1; contradicted operationally by `run-headed.sh:30-33`; coder ckpt overfit |
| C17 | Sample app with seeded defects provides defect-detection ground truth | `sample_app/main.py:20-48`; `USER_STORIES.md` | CONFIRMED as design; detection-rate experiment itself EVIDENCE REQUIRED |
| C18 | UI Scanner produces validated locators with deterministic candidate ladder | branch `feature/UI-Scanner-locators` (126 files, tests) | CONFIRMED **branch-only, unmerged** |
| C19 | ~430 automated unit tests across tiers | engine ≈361 unit fns; backend 64 Jest + 7 e2e; frontend 35 Vitest | CONFIRMED (static counts; rerun for exact figures) |
| C20 | Security hardening (RBAC, allow-lists, redaction, prompt-injection guards, SSRF) | `permissions.ts`; `conftest.py`; `security.py`; agent prompts; branch SSRF checks | CONFIRMED (SSRF branch-only) |
| C21 | System used with real requirement documents | backend evidence xlsx (synthetic); branch-only Keepme docx uploads | PARTIAL — Keepme docs confidential; usage evidence in Postgres volume |
| C22 | User satisfaction / SUS study | instrument only (`metrics/satisfaction.py`) | NOT DONE — never claim |
| C23 | Statistical significance of model differences | — | NOT SUPPORTED — never claim |

---

## 11. Materials received 2026-08-22 and cross-check against the repository

Received: KLE formatting rules (text only — template file NOT received); title page "attached herewith" but NOT received; approved proposal CSC-40040 (17 Jun 2026, full text); RQ document (7 Jul 2026: title, name, RQ What/Why/How); literature table (8 papers); before-fine-tune evaluation workbook (image); after-fine-tune evaluation workbook (image).

Confirmed from materials: title = "AI Quality Assurance Agent for SaaS Applications: UI, API and Regression Testing with CI/CD Pipeline" (identical in proposal and RQ doc — adopted; supersedes the provisional phrasing). Author Rakshan Dangol. Module CSC-40040. RQ1/RQ2/RQ3 as in research_question_traceability.md.

Cross-check findings (to resolve before/while drafting):

1. **Proposal ethics vs Keepme material.** Proposal commits to open-source/demo/synthetic targets and no private data; repo contains employer-named ("Keepme") artefacts (committed .env.example reference, keepme_login_page.py, branch-only uploaded Keepme_*.docx, work email in docx header). Consistent resolution: exclude/anonymise all Keepme material (register §10) and state the synthetic-data scope in Ch3.
2. **Before-fine-tune workbook internal inconsistency.** Per-task "Response Accuracy" (qwen2.5 0.41/0.35/0.5; coder 0.34/0.43/0.5; deepseek 0.34/0.28/0.3) is arithmetically incompatible with the "Avg Accuracy" summary (0.86/0.86/0.3). Needs the calculation basis or correction.
3. **Workbook "LLM as a Judge" table vs database.** eval_results.sqlite contains no judgement rows and no qwen3.5 traces; the workbook's judge-labelled numbers closely resemble the framework's deterministic metrics (consistency 59.73–76.28 matches DB-style 0–100 consistency). Need: which script/run produced these numbers; if the judge ran interactively, its logs. Also mixed hallucination scales in one column (0.4–0.75 fractions vs 6.2/8 percentages).
4. **After-fine-tune workbook: unsupported models/benchmarks.** `qwen3.5-qa:9b` and `qwen2.5-coder-1.5b-codealpaca`, and all HumanEval/HumanEval+ before/after rows, have zero footprint in the repository (no configs, logs, adapters, or harness). Provenance required (scripts/notebooks/Colab links/logs) or these rows are excluded from the dissertation.
5. **After-fine-tune workbook vs repo eval.** Workbook evaluates on sample-app features (Login / add Admin / add Product); repo's `work/eval_report.json` evaluates on the held-out Beacon Helpdesk app with different latencies (e.g. coder 48.4 s vs workbook 15–92 s). These are two different experiments; both can be reported if the workbook runs gain provenance. Corroboration exists: preflight log lists platform projects "Login qwen2.5-coder-qa:7b", "Login FineTune model", "Add Admin - pretrained", etc. → the PostgreSQL export (checklist 19c) is the likely evidence trail.
6. **After-fine-tune "Human Verified" table plausibility.** Several coverage/consistency values are identical to the before-table rows (e.g. test_plan 0.6782/74.67 appears for qwen2.5:latest before AND qwen2.5-qa + qwen3.5-qa after; automation 0.5358/93 duplicated across two models), and hallucination/executability/code-quality/reliability are uniformly 1 — implausible perfection that conflicts with run-headed.sh's hallucination comment. Needs the verification procedure description and raw worksheets; otherwise reported with heavy caveats or excluded.
7. **"User Satisfaction" rows (Satisfied/not-satisfied).** No participants/instrument evidenced; presumed single-researcher judgement. Will be reported as the researcher's structured qualitative assessment, never as a user study; SUS remains "designed, not conducted".
8. **Literature table.** 8 papers recorded in reference_verification.md; PDFs/DOIs still needed to reach VERIFIED status (esp. Li 2024, Zhang 2023, Haroon 2026).
9. **Formatting rules** captured (A4, TNR, double spacing, ≥1.5in/1in margins, bottom-right page numbers, 10–15k excl. contents/abstract/references/appendices, third-person passive past tense, Word + zipped Turnitin + Submission Declaration Form, appendices must include ethics form + ALL or sample of anonymised primary data + source code). Template file and title page still to be supplied as files.

### §11a. E1 export completed and workbook reconciliation (2026-08-22, post-approval)

The three evaluation batches in `feature/llm-evaluation:eval_results.sqlite` were exported with the branch's own `evaluation.cli export` (ephemeral pandas environment; no project dependencies changed). Outputs: `docs/dissertation/data/e1_export/` (18 files: runs_wide, research_table, summary_by_model, summary_by_model_task, aggregate_metrics, results.json per batch). DB confirmed: 59 runs; **0 judgement rows; 0 satisfaction rows**.

Verified E1 results now available for Ch7:
- Batch `170001` (deep-metric): qwen2.5:latest overall 0.783 vs qwen2.5-coder:latest 0.7332 (n=12 runs each, accuracy_std present; per-task research_scores 0.77–0.92; consistency with per-component detail; reliability 1.0, zero failures).
- Batch `152014`: all three models; **deepseek-r1:8b = 2 test_plan runs only** (accuracy 0.38, latency 121.2 s).
- Batch `151054`: qwen2.5 only (21 runs incl. robustness variants).

**Workbook reconciliation (decisive):**
1. Before-workbook "Avg Accuracy" row (0.86 / 0.86 / 0.3) = batch `152014` `summary_by_model.accuracy_mean` (0.8627 / 0.8588 / 0.38) — REAL, DB-traceable. Deepseek test_plan latency 121 s also matches. The per-task "Response Accuracy" grid (0.41/0.35/0.5 …) matches NO DB value — provenance unknown.
2. **After-workbook "Human Verified" table matches, cell by cell, the batch-`170001` deterministic research_table for the BASE models** (e.g. "qwen2.5-coder-qa automation 0.6 / 0.5715 / 99.73 / 1 / 1 / 1 / 1" ≡ export row for qwen2.5-coder:latest automation; "qwen2.5-qa test_cases 1 / 0.9285 / 86.28" ≡ qwen2.5:latest test_cases; the `qwen3.5-qa:9b` rows duplicate the qwen2.5:latest rows). The DB contains no fine-tuned-model runs and the registry holds no fine-tuned specs. **As presented, the "Human Verified" after-table is the base-model framework output relabelled as fine-tuned results and CANNOT be used as fine-tuning evidence.** The before-workbook "LLM as a Judge" table contains the same base-model values with varying amounts subtracted — provenance unknown.
3. Consequence for Ch7 unless genuine raw measurements are produced: E1 is reported from the export tables; E2 before/after is reported from `finetune/work/eval_report.json` + training logs + (once exported) the PostgreSQL platform projects; the workbook's HumanEval/HumanEval+ rows, `qwen3.5-qa:9b`, `qwen2.5-coder-1.5b-codealpaca`, per-task before-accuracies and the "Human Verified" table are EXCLUDED.

Still outstanding after this delivery: KLE template file; title-page file; Candidate's Declaration wording; Submission Declaration Form; student number; exact degree/programme, university/school names; supervisor name; deadline; ethical approval outcome document; SRS V1–V3 docx; supervisor feedback/weekly reports; literature PDFs; Harvard guide; AI-use policy; GitHub Actions run evidence; PostgreSQL export; fine-tune hardware spec; provenance for items 3–6 above; Keepme confidentiality decision.

## 10. Anonymisation / redaction action list (before any submission or repo hand-over)

1. Replace `SUPEROWNER_EMAIL` default and e2e fixture literal with placeholders.
2. Reduce `.env.example` / `.env.v2.example` to placeholder values; rotate anything live.
3. Remove/rename `keepme_login_page.py`; scrub "Keepme"/keepme.ai from `.env.example`, artifacts, docx header; confirm employer permission or exclude the branch-only `Keepme_*.docx` uploads entirely.
4. Replace inlined dev admin credentials in `docker-compose.yml`, `demo-preflight.sh`, `run-headed.sh` (or annotate as demo placeholders).
5. Decide licence for the repo; record base-model licences (Qwen Apache-2.0; mlx-community derivatives; llama.cpp MIT).
