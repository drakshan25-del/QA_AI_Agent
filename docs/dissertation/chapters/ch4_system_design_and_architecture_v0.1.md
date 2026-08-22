<!-- EDITORIAL NOTE (not dissertation content, excluded from word count):
Draft v0.1 of Chapter 4. Target 1,700 counted words. Style: British English, third-person passive, past tense.
Parenthetical file paths are evidence anchors; at final formatting they become Appendix I cross-references.
Figure/table placeholders carry final captions; diagrams will be rendered from the cited sources only.
All claims trace to dissertation_evidence_register.md. -->

# Chapter 4 — System Design and Architecture

## 4.1 Architectural overview

The system was designed as a three-tier web platform in which responsibility for artificial-intelligence inference, state ownership and user interaction was deliberately separated. A React single-page application (port 5173) communicated with a NestJS backend (port 4000) over a versioned REST interface and a WebSocket event channel; the backend, in turn, was the only component permitted to call a stateless Python FastAPI engine (port 8100), which wrapped the language-model agents, the validation tooling and the Playwright execution runtime. A self-contained demonstration application (port 8001) served as the system under test, and model inference was provided by an Ollama host that was reachable from the engine alone (docker-compose.yml; docs/V2_CONTRACT.md).

**[Figure 4.1 — Container architecture of the platform, showing the three tiers, the sample application, the database and the Ollama model host, with trust boundaries and authentication mechanisms annotated. Source: docker-compose.yml and docs/V2_CONTRACT.md.]**

The design was governed by a single invariant, stated in the project documentation as "AI proposes; deterministic tools validate and execute" (README.md). Generated code was treated as untrusted input until it had passed syntactic, security and collection checks, and no execution, commit, push or pipeline dispatch could occur without a recorded human approval. This principle was not merely documentary: it was traced during the audit to concrete enforcement points in the backend services, where each guard returned an HTTP 409 conflict with a typed error code when its precondition was unmet (apps/backend/src/modules/approvals/approvals.service.ts; executions, git and CI services).

A strict ownership rule completed the overview: the backend database was the single system of record, while the engine remained stateless between calls, holding only a disposable runtime workspace. Every artefact, decision and audit record produced by the engine was persisted by the backend, a division that simplified recovery and made the engine replaceable in principle.

## 4.2 Integration contracts

The interfaces between tiers were pinned in a written contract (docs/V2_CONTRACT.md) and in versioned Pydantic schemas (apps/qa-engine/engine/contracts/schemas.py, `SCHEMA_VERSION = "v1"`). Three properties of the contract design were considered significant.

First, authentication was asymmetric by design. Browsers held only a fifteen-minute JSON Web Token, refreshed through an HTTP-only cookie, whereas the backend authenticated to the engine with a shared token compared in constant time; neither the engine token nor the GitHub token was ever exposed to the client. Second, generation requests carried an `Idempotency-Key` header that the engine cached for twenty-four hours, so a retried submission returned the original result instead of incurring a second inference — a pragmatic response to local-model latencies measured in minutes. Third, every request was stamped with a correlation identifier that was propagated from the browser, through the backend, into engine logs, enabling a single user action to be traced across all three processes.

Table 4.1 summarises the engine's internal interface, which comprised sixteen endpoints covering parsing, analysis, plan, case and code generation, validation, execution planning, execution, cancellation, failure classification, reporting and regression comparison (apps/qa-engine/engine/service/main.py).

**[Table 4.1 — Engine internal API (`/internal/v1/*`): endpoint, purpose, and whether a language model is invoked. Source: engine/service/main.py.]**

## 4.3 The pipeline and its approval gates

The generation workflow was designed as a nine-stage pipeline — upload, parse, analyse, plan, cases, automation, validation, execution and reporting — interrupted by human approval gates at every irreversible transition. Four gates were enforced: approval of test cases before automation could be generated; passed validation before generated code could be approved; approval, validation and active status before execution; and approval plus validation before any Git commit or CI dispatch.

**[Figure 4.2 — The nine-stage pipeline with approval gates and the invalidation cascade. Source: graph/workflow.py docstring and approvals.service.ts.]**

A notable design decision was that approval was bound to an artefact *version*. When an approved artefact was edited, the backend reset its approval status, marked the previous approval record as invalidated, and cascaded the reset to every downstream artefact derived from it; editing an approved test case therefore returned all automation generated from it to a pending state (approvals.service.ts, `onUpstreamModified`). This guaranteed that reviewed code could never drift silently from the code that was actually approved — a property that distinguished the design from autonomous agent frameworks in which generated changes are applied without versioned human sign-off.

## 4.4 State machines and artefact lifecycle

Status fields were never assigned as free-form strings. Four explicit transition maps governed generation jobs, execution runs, validation outcomes and report publication, and any illegal transition raised a 409 error carrying the set of permitted moves (apps/backend/src/common/state-machines.ts). Two defensive rules deserved emphasis. The terminal outcome of an execution run was derived from parsed metrics rather than from the process exit code, and an empty metrics object was deliberately mapped to *failed*, so that a run which produced no results could never be reported as successful. Similarly, the six-state artefact lifecycle (draft, under review, approved, rejected, superseded, archived) was *derived* from existing columns rather than stored, avoiding schema migration while keeping the lifecycle auditable.

**[Figure 4.3 — State machines for generation jobs and execution runs, drawn from the literal transition maps. Source: state-machines.ts.]**

## 4.5 Data model

The persistence layer comprised twenty-five TypeORM entities spanning projects, documents and their segments, requirements, analyses, plans, cases, generated artefacts, generation runs, execution runs, per-test results, regression comparisons, findings, approvals, jobs, events, notifications, sequences and an append-only audit log (apps/backend/src/entities/). Artefact rows carried provenance columns — a SHA-256 content hash, a monotonic version, the producing generation run, and the schema version of the engine contract — so that lineage from an uploaded document to a generated test file could be reconstructed.

Two honest limitations of the data design were recorded. Associations were modelled as plain foreign-key columns and JSON identifier arrays resolved in application code; no database-level foreign-key constraints or cascades existed, so referential integrity depended entirely on service logic. Furthermore, the schema was created by TypeORM's `synchronize` option on boot for both PostgreSQL and the SQLite development fallback, and no migration framework was present — acceptable for a research prototype, but identified as a prerequisite gap for any deployment in which data must survive entity changes (apps/backend/src/database/database.module.ts).

## 4.6 Real-time event architecture

Live visibility of browser execution was a primary requirement, and the event path was designed around ordered, replayable streams. Instrumented page-object actions emitted step events into a bounded in-process queue inside the pytest child process; a background thread posted them to a loopback ingestion endpoint on the engine; an in-memory event bus assigned monotonic sequence numbers and retained history; the backend consumed the resulting Server-Sent Events stream, persisted every event, and re-broadcast envelopes over socket.io rooms scoped to project, run and user (engine/service/step_events.py; eventbus.py; apps/backend/src/modules/events/). Because every hop carried a sequence number, a reconnecting client could resume from its last observed position, and a finished run could be replayed in full from persisted rows. Back-pressure was handled by dropping the oldest telemetry rather than blocking the browser-driving thread — a deliberate trade of completeness for liveness.

## 4.7 Security architecture

Untrusted input reached the system from three directions — uploaded documents, language-model output and the application under test — and each was given a containment layer. Role-based access control was expressed as a static role-to-permission matrix with fourteen permissions; self-registration could never confer a privileged role, and account administration was reserved to a distinct superowner role that even administrators could not exercise (apps/backend/src/common/access/permissions.ts).

**[Table 4.2 — Role × permission matrix. Source: permissions.ts.]**

Generated code was constrained twice: statically, by the validation gate described in Chapter 5, and at runtime, by a browser route handler and an HTTP client hook that both refused requests to hosts outside a per-project domain allow-list, with an empty list falling back to localhost rather than to allow-all (automation/conftest.py). Prompt injection was mitigated structurally as well as textually: every agent prompt carried an explicit guard declaring delimited content to be data rather than instructions, and any injected instruction that nevertheless succeeded would still have had to survive schema validation, the static gate and a human diff review before execution. Secrets were masked in logs, step events and reports, and WebSocket authentication deliberately avoided query-string token transport to keep credentials out of proxy logs.

## 4.8 Regression and CI/CD design

Regression support was designed as a stateless comparison over per-test outcomes. One execution run per project could be promoted to baseline — promotion cleared the flag from every other run, preserving a single-baseline invariant — and a comparison classified each test into regressions, fixes, still-failing, new, missing or skipped, with a single derived boolean, `has_regressions`, intended as the signal a quality gate keys on (apps/qa-engine/app/services/regression.py; backend regression module).

Suite selection in the pipeline was made deterministic through a marker algebra: the engine, not the model, applied pytest markers to generated files, and the five continuous-integration suites — smoke, UI, API, regression and staging — selected tests purely by marker expression, with the algebra arranged so that no file could be executed by two suites (docs/V2_CONTRACT.md §3). The CI design ran no language model: generation was defined as a local, human-supervised activity, and the pipeline only validated and executed committed tests, uploading JUnit reports and evidence artefacts on every run. It must be recorded that the workflow file itself was deleted from the main branch by the project's final commit and survived only in version-control history; the consequences of this are examined in Chapter 7.

## 4.9 Language-model routing

Model access was designed per project rather than per installation. A project was configured either as LOCAL, resolving to the host Ollama instance, or as CLOUD, in which case an OpenAI-compatible chat-completions client was directed at one of four providers (OpenAI, Anthropic, OpenRouter, Groq) or a custom endpoint, with the API key sealed under AES-256-GCM in the database and never logged (apps/backend/src/common/llm/; apps/qa-engine/app/core/llm.py). The engine activated the per-request configuration through a context variable, so concurrent projects could use different models without interference.

## 4.10 Design alternatives and trade-offs

Two roads not taken were considered instructive. First, the pipeline had originally been implemented as a LangGraph state graph with interrupt-based human gates and a checkpointer; the production system instead re-implemented the orchestration imperatively in backend services, retaining the graph only as a demonstration script. The imperative design was judged easier to bind to persistent jobs, retries and audit records, but the duplication of workflow logic across two languages was acknowledged as technical debt. Second, all queueing, sequencing and idempotency state was kept in process memory rather than in an external broker, which bounded the system to a single backend and a single engine instance; this was accepted for a research prototype in exchange for operational simplicity, and its scalability consequences are discussed in Chapter 8.

<!-- EDITORIAL NOTE: counted words this draft ≈ 1,540 (excluding notes, headings counted). Within budget 1,700 ± 10%. -->
