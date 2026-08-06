# QA AI Agents — Frontend (V2)

React 18 + Vite + TypeScript SPA for the **Agentic AI Quality Assurance System V2**.
It is the browser tier of the three-tier platform and talks **only** to the NestJS
backend over REST (`/api/v2/*`) and a socket.io WebSocket (`/api/v2/events`) — it never
contacts the engine or holds secrets (FR-FE-004, SEC-002). Built to `docs/V2_CONTRACT.md`.

## Stack

- **React 18** + **react-router-dom v6** (route-based pages, no full reload)
- **@tanstack/react-query** for server state + cache invalidation on realtime events
- **axios** client: `baseURL` from `VITE_API_BASE`, attaches the JWT, generates an
  `x-correlation-id` per request, and refreshes the access token once on a `401`
- **socket.io-client** to `VITE_WS_BASE` for the live execution stream
- **react-syntax-highlighter** for the code viewer (lazy-loaded to keep the bundle lean)
- Lightweight CSS-modules design system (light/dark aware) — no heavy UI kit

## Setup

```bash
cp .env.example .env.local        # set VITE_API_BASE / VITE_WS_BASE
npm install
npm run dev                       # http://localhost:5173
```

### Environment (`.env.example`)

| Var             | Default                              | Purpose                          |
| --------------- | ------------------------------------ | -------------------------------- |
| `VITE_API_BASE` | `http://localhost:4000/api/v2`       | Backend REST base (FR-FE-004)    |
| `VITE_WS_BASE`  | `ws://localhost:4000`                | WebSocket base for `/api/v2/events` |

Vite inlines `VITE_*` at build time; in Docker they are passed as build args.

## Scripts

| Script            | Description                                   |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Vite dev server on :5173                      |
| `npm run build`   | `tsc -b` (strict typecheck) + `vite build`    |
| `npm run preview` | Serve the production build locally            |
| `npm test`        | Run the vitest suite                          |

## Routes (FR-FE-002)

`/login` · `/dashboard` · `/projects/new` · `/projects/:id` (workflow overview) ·
`/projects/:id/settings` · `/projects/:id/upload` (drag-and-drop centre) ·
`/documents/:id/preview` (segment toggles) · `/projects/:id/analysis` ·
`/projects/:id/test-plan` · `/projects/:id/test-cases` · `/projects/:id/automation` ·
`/projects/:id/validation` · `/approvals` (inbox) · `/executions/:id` (live timeline) ·
`/executions/:id/report` · `/projects/:id/reports` · `/audit`.

Every route except `/login` is behind `ProtectedRoute`. The access token lives only in
memory; a page reload silently re-acquires it via the HTTP-only refresh cookie.

## Architecture (Appendix A)

```
src/
  components/            shared UI (Layout, CodeViewer, DiffViewer, QueryState, ui/*)
  pages/                 one component per route
  features/
    projects/            project form + hooks
    uploads/             dropzone + upload queue
    test-plans/          editable section editor
    test-cases/          edit modal
    automation/          validation findings viewer
    approvals/           approval-gate controls
    executions/          timeline reducer, useExecutionEvents (WS), step labels
    reports/             report normaliser + report view
  services/api/          axios client, typed endpoints, tokenStore, download, types
  hooks/                 useSocket, useProjectEvents
  auth/                  AuthContext, ProtectedRoute
```

### Realtime

`useSocket` opens a socket.io connection (auth token + `projectId`/`runId` in the
handshake). `useProjectEvents` invalidates react-query caches on `*.ready`/`job.*`/
`approval.updated`. `useExecutionEvents` folds `execution.step`/`execution.status`
envelopes into an ordered, de-duplicated timeline via the pure `timelineReducer`
(seeded from persisted events for replay, and re-synced from `lastSeq` on reconnect).

### Content safety (FR-FE-006, SEC-004)

Uploaded and AI-generated content is rendered as escaped JSX text — never via
`dangerouslySetInnerHTML`. Links are defanged (`safeHref`), and generated code is
tokenised as text by the highlighter, not injected as HTML.

## Tests

- `src/features/executions/executionTimeline.test.ts` — reducer ordering, dedup,
  grouping, status coercion, hydrate/replay.
- `src/pages/LoginPage.test.tsx` — form render, successful login + navigation,
  meaningful error on rejected credentials.

## Docker

```bash
docker build \
  --build-arg VITE_API_BASE=http://localhost:4000/api/v2 \
  --build-arg VITE_WS_BASE=ws://localhost:4000 \
  -t qa-frontend .
docker run -p 5173:80 qa-frontend
```

Serves the static build via nginx with SPA fallback (`try_files … /index.html`).
