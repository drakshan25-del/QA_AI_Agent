# V2 integration contract

The interfaces every tier is built against. Three surfaces:

```
React frontend  ──REST /api/v2/* + WS──▶  NestJS backend  ──HTTP /internal/v1/* + SSE──▶  Python engine
```

The backend is the system of record; the engine is stateless between calls
(idempotency-key caching aside). Schema changes to either surface must be
reflected here.

## 1. Engine internal API (`/internal/v1/*`, FastAPI :8100)

Every request carries `X-Engine-Token` (constant-time compared). Generation
endpoints additionally accept `Idempotency-Key` (24 h in-memory cache) and
`X-Correlation-Id` (echoed into logs). Payload schemas are pinned by
`engine/contracts/schemas.py` (`SCHEMA_VERSION = "v1"`).

| Endpoint | Purpose |
|---|---|
| `GET  /health` | liveness + model availability |
| `POST /parse` | documents → parsed segments |
| `POST /analyse` | segments → requirement analysis |
| `POST /test-plan` | analysis → test plan |
| `POST /test-cases` | plan → test cases |
| `POST /automation` | test cases → generated pytest/Playwright files |
| `POST /validate` | static gate over generated code |
| `POST /execution-plan` | test file → step plan for live visualisation |
| `POST /execute` | run generated tests; SSE step events |
| `POST /executions/{runId}/cancel` | stop a running execution |
| `GET  /runs/{runId}/events` | SSE stream (`id:`/`event:`/`data:` frames) |
| `POST /classify` | failure classification |
| `POST /report` / `POST /render-pdf` | report JSON / PDF rendering |
| `POST /regression-compare` | baseline vs current run comparison |

### 1.1 `POST /automation` — test-type aware generation

Request body:

```jsonc
{
  "testCases": [ { "id": "…", "case_key": "…", "title": "…", "steps": [], "expected_results": [], "test_data": {}, "preconditions": [] } ],
  "baseUrl": "http://localhost:8001",
  "pageObjectsSummary": "",          // optional, discovered when empty
  "model": "qwen2.5:latest",         // optional override
  "temperature": 0.1,
  "testType": "ui",                  // "ui" (default) | "api"
  "extraMarkers": ["regression"],    // extra pytest markers, see §3
  "apiSummary": ""                   // api type: authoritative API surface — the backend
                                     // sends the parsed `api_doc` uploads + requirement text
}
```

Response `AutomationOutput`: `{ files: [{ path, kind: "test_file"|"page_object"|"fixture", content, test_case_ids }], notes }`.

Behaviour per type:

- **`ui`** — sync Playwright tests using page objects (`automation/pages/*`),
  written to `automation/generated_tests/test_<slug>.py`.
- **`api`** — browser-free tests using the guarded `api_client` httpx fixture
  with relative paths, written to `test_api_<slug>.py`. Playwright imports and
  `page` fixtures are rejected by the engine's post-generation checks. When
  `apiSummary` contains extractable `METHOD /path` pairs, every `api_client`
  call must match a documented endpoint (method AND path; `{id}`/`:id`
  templates match one segment) — undocumented routes are rejected and
  regenerated, so invented endpoints never reach execution. For api
  generation the backend sends the project's `apiBaseUrl` (falling back to
  `baseUrl`) as `baseUrl`.

`POST /execute` additionally accepts `targetApiBaseUrl` → exported to the
runner as `QA_TARGET_API_BASE_URL`; the `api_client` fixture resolves relative
paths against it (falling back to `QA_TARGET_BASE_URL`). The backend also
merges the hosts of both configured target URLs into `allowedDomains` so a
project whose API lives on another host runs instead of being guard-refused.

Materialise ownership guard: the engine records every file it materialises
(path + content hash in `automation/.materialised.json`) and only ever
overwrites files it wrote itself. Existing files with different content —
the framework's `base_page.py`, hand-written page objects, externally edited
files — are kept and reported in the run's status detail, never clobbered.
The backend additionally never sends artifacts named `base_page.py`,
`__init__.py` or `conftest.py`, and generation discards page objects that
shadow those framework-owned modules.

Marker enforcement is deterministic (not left to the LLM): every test file gets
`generated`; api files additionally get `api`; each `extraMarkers` entry is
merged in. Unknown `testType` → 422.

### 1.2 `POST /regression-compare`

Stateless comparison of two runs' per-test outcomes. Request:

```jsonc
{
  "baseline": [ { "node_id": "automation/generated_tests/test_x.py::test_a", "outcome": "passed" } ],
  "current":  [ { "node_id": "…", "outcome": "failed" } ]
}
```

Rows are the shape `parse_junit` produces; only `node_id` and `outcome`
(`passed|failed|skipped|error`; `error` counts as failing) are read. Response:

```jsonc
{
  "regressions":   ["node_id"],                    // pass → fail  (the gate signal)
  "fixes":         ["node_id"],                    // fail → pass
  "still_failing": ["node_id"],                    // fail → fail (pre-existing)
  "skipped":       ["node_id"],                    // skipped in either run
  "new_tests":     [{ "node_id": "…", "status": "pass|fail|skip" }],
  "missing_tests": ["node_id"],                    // in baseline, absent now
  "stable_passes": 12,
  "summary": { "baseline_total": 0, "current_total": 0, "regressed": 0,
               "fixed": 0, "still_failing": 0, "new": 0, "missing": 0,
               "has_regressions": false }
}
```

A newly added failing test is **not** a regression; duplicate node ids keep the
last occurrence (rerun-friendly).

## 2. Backend REST additions (`/api/v2/*`)

### 2.1 Automation generation

`POST /api/v2/projects/:projectId/automation/generate` accepts, alongside
`testCaseIds` and `draftPreview`:

- `testType`: `"ui"` (default) | `"api"`
- `regressionSuite`: `boolean` — tag the generated files into the regression
  suite via markers (see §3)

Both fields are persisted on each `generated_artifacts` row and replayed on job
retry.

### 2.2 Regression comparisons

- `POST /api/v2/projects/:projectId/regression-comparisons`
  `{ baselineRunId, candidateRunId }` → creates and returns a comparison
  (synchronous; the engine call is stateless). Requires the
  `regression.compare` permission + project membership.
- `GET /api/v2/projects/:projectId/regression-comparisons` → newest-first list.
- `GET /api/v2/regression-comparisons/:id` → single comparison.
- `POST /api/v2/executions/:id/baseline` → promotes the run to the project's
  single regression baseline (`isBaseline`; the previous baseline is cleared).

A comparison row stores the full engine result plus a denormalised
`hasRegressions` flag.

## 3. Suite marker algebra

Suites are selected purely by pytest markers (declared in
`apps/qa-engine/pyproject.toml`). The backend computes `extraMarkers` from
(`testType`, `regressionSuite`); the engine merges them with its automatic
markers:

| testType | regressionSuite | markers on generated files |
|---|---|---|
| ui | no | `generated, ui` |
| ui | yes | `generated, regression` (deliberately **no** `ui`) |
| api | no | `generated, api` |
| api | yes | `generated, api, regression` |

CI (`.github/workflows/playwright-ci.yml`) runs the suites with matching
expressions — regression-UI files carry no `ui` marker and regression-API files
are excluded via `not regression`, so nothing is double-run:

| CI suite | marker expression |
|---|---|
| smoke | `smoke` |
| ui | `ui and generated` |
| api | `api and generated and not regression` |
| regression | `regression and generated` |
| staging | `generated and not ui and not api and not regression` |

The regression CI suite is followed by a **gate**: the current
`junit-regression.xml` is compared (via `scripts/regression_gate.py`, which
reuses `parse_junit` + `compare_runs`) against the same artifact from the last
successful `main` run; the job fails iff `summary.has_regressions` is true. A
missing baseline (first run) is tolerated.
