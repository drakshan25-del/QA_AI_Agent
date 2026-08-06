# Agentic AI QA System V2 — Backend (NestJS)

System of record and the only service the browser talks to (FR-BE-001..006,
FR-FE-004). Built against `docs/V2_CONTRACT.md`. TypeScript strict, NestJS 10,
TypeORM 0.3, JWT auth, socket.io real-time events, and a typed engine client.

## Stack

- **NestJS 10** (Express platform), TypeScript strict mode
- **TypeORM 0.3** with a driver switch: `DB_DRIVER=postgres` (pg + `DATABASE_URL`)
  or `DB_DRIVER=sqlite` (better-sqlite3, local file) — the no-Docker dev fallback.
  `synchronize: true` builds the schema on boot in dev.
- **@nestjs/jwt + passport-jwt** — access token (15m) + HTTP-only refresh cookie (7d)
- **@nestjs/websockets + socket.io** — real-time events at `/api/v2/events`
- **axios** engine client — `X-Engine-Token`, `X-Correlation-Id`, `Idempotency-Key`
- **class-validator / class-transformer**, **multer** uploads, **@nestjs/swagger**

## Quick start

```bash
cd apps/backend
npm install                     # native better-sqlite3 builds here
cp .env.example .env            # then edit secrets (SEC-002)

# SQLite dev fallback (no Docker/Postgres needed):
DB_DRIVER=sqlite \
JWT_ACCESS_SECRET=dev-access JWT_REFRESH_SECRET=dev-refresh \
ENGINE_URL=http://localhost:8100 ENGINE_TOKEN=dev-engine-token \
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=admin12345 \
PORT=4000 npm run start:dev

# Postgres:
DB_DRIVER=postgres DATABASE_URL=postgres://qa:qa@localhost:5432/qa_v2 ... npm run start
```

- REST base: `http://localhost:4000/api/v2`
- Swagger UI: `http://localhost:4000/api/docs`
- WebSocket events: `ws://localhost:4000/api/v2/events?projectId=&runId=` (+ token)
- Health: `GET /api/v2/health` → `{ status, api, database, engine, ollama }`

## Scripts

| script | purpose |
| --- | --- |
| `npm run build` | `tsc` via `nest build` (strict) |
| `npm run start` | run compiled `dist/main.js` |
| `npm run start:dev` | watch-mode dev server |
| `npm test` | Jest unit tests (`src/**/*.spec.ts`) |
| `npm run test:e2e` | Jest e2e (`test/*.e2e-spec.ts`, in-memory SQLite) |

## Architecture

```
Browser ──REST /api/v2/* + WS /api/v2/events──▶ NestJS backend ──HTTP + SSE──▶ Engine (:8100)
                                                     │
                                        TypeORM (Postgres | SQLite dev)
```

- Every mutation writes an `AuditEvent` (FR-AUD-001/004); secrets are redacted
  from logs and error payloads (SEC-007).
- Generation endpoints (`analysis`, `test-plan`, `test-cases`, `automation`)
  create a `Job`, acknowledge within 2s (NFR-PERF-001, `202 Accepted`), then call
  the engine and persist results in the background, emitting WS events.
- Approval gates (FR-HITL-005, FR-TP/TC/AUT, FR-VAL-007) are enforced server-side:
  invalid transitions return `409` + audit. Editing an approved upstream artefact
  invalidates downstream approvals.
- Executions call the engine `POST /execute`, then the events gateway consumes the
  engine SSE stream `GET /internal/v1/runs/{id}/events`, persists `ExecutionEvent`
  rows, and rebroadcasts envelopes over WS scoped by `projectId`/`runId`.
- The engine token and `GITHUB_TOKEN` are server-side only and never sent to the
  browser (FR-CI-004).

### Modules (`src/modules/`)

`auth · projects · documents · requirements · analysis · test-plans · test-cases ·
automation · executions · findings · reports · git · ci · approvals · jobs · events ·
audit · health`, plus `src/engine/engine.client.ts` and `src/entities/*.entity.ts`.

## Error contract (FR-BE-001)

```json
{ "error": { "code": "string", "message": "string", "details": {}, "correlationId": "uuid" } }
```

## Documented gaps in this tier

- `test-plan` / `report` export to `docx`/`pdf` returns the Markdown/HTML payload
  (no binary renderer bundled).
- `git/commit` writes into a per-project local workspace repo (real local commit,
  no network push). `ci/dispatch` calls the GitHub API only when `GITHUB_TOKEN` +
  `repository` are configured; otherwise it is simulated and flagged.
- Password hashing uses `bcryptjs` (pure-JS, bcrypt-compatible) to avoid a native
  build on bleeding-edge Node; isolated in `PasswordService` for a one-line swap.
