#!/usr/bin/env bash
# run-headed.sh — run the stack with the Python engine ON THE HOST so headed
# Playwright executions open a real, visible Chrome window on your screen
# (impossible inside Docker: containers have no display).
#
# Works like `docker compose up`:
#   - starts everything in dependency order with health-check waits
#   - streams prefixed logs from every service
#   - Ctrl+C stops all of it
#
# Only Postgres stays in Docker (same pgdata volume), so your workspace data,
# projects and the admin login are IDENTICAL to the docker compose stack.
# To go back to the all-Docker stack: Ctrl+C here, then `docker compose up -d`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$ROOT/apps/qa-engine"
BACKEND_DIR="$ROOT/apps/backend"
FRONTEND_DIR="$ROOT/apps/frontend"

# ---- configuration (override any of these via environment) ----
: "${ENGINE_TOKEN:=dev-engine-token}"
: "${JWT_ACCESS_SECRET:=dev-access-secret}"
: "${JWT_REFRESH_SECRET:=dev-refresh-secret}"
: "${SEED_ADMIN_EMAIL:=rakshandangol93@gmail.com}"
: "${SEED_ADMIN_PASSWORD:=In-Silence-2026}"
: "${QA_OLLAMA_BASE_URL:=http://localhost:11434}"
: "${QA_LLM_MODEL:=qwen2.5:latest}"
# Dedicated code model for automation generation. The base coder model is
# deliberately preferred over the qwen2.5-coder-qa fine-tune: the fine-tune
# hallucinates page-object methods and emits unparseable files often enough
# to exhaust the generation retry budget.
: "${QA_LLM_CODER_MODEL:=qwen2.5-coder:7b}"
: "${QA_TARGET_BASE_URL:=http://localhost:8001}"
: "${QA_ALLOWED_DOMAINS:=localhost,127.0.0.1}"

say()  { printf '\033[1;36m[run-headed]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[run-headed]\033[0m %s\n' "$*" >&2; exit 1; }

# Prefix a service's output, compose-style. Each service's raw output is also
# tee'd to logs/<service>.log (fresh per launch) so a failure can be diagnosed
# after the fact from a single small file.
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
logpipe() { sed -e "s/^/$1| /"; }

wait_http() { # wait_http <name> <url> <tries>
  local name="$1" url="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then say "$name is healthy ($url)"; return 0; fi
    sleep 1
  done
  die "$name did not become healthy at $url"
}

cleanup() {
  trap - INT TERM EXIT
  echo
  say "stopping all services…"
  kill 0 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ---- prerequisites ----
command -v uv >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"
command -v uv     >/dev/null 2>&1 || die "uv not found — install: curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v npm    >/dev/null 2>&1 || die "npm not found — install Node 22+"
command -v docker >/dev/null 2>&1 || die "docker not found — Postgres runs in Docker (or set DB_DRIVER=sqlite yourself)"

curl -fsS -o /dev/null "$QA_OLLAMA_BASE_URL/api/tags" 2>/dev/null \
  || say "WARNING: Ollama not reachable at $QA_OLLAMA_BASE_URL — generation steps will fail (executions still work)"

# ---- free the ports: stop the Docker app services (postgres stays) ----
say "stopping Docker app services so host services can take their ports…"
docker compose -f "$ROOT/docker-compose.yml" stop backend frontend engine sample-app 2>/dev/null || true

for port in 4000 5173 8100 8001; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN
    die "port $port is still in use (see above) — stop that process first"
  fi
done

# ---- workspace self-heal (host runs use the live working tree) ----
# Generated page objects import the git-owned framework files below; the
# backend never sends them with a run, so if they go missing on the host every
# execution dies at pytest collection. Restore any that are tracked-but-absent
# (never touch files that merely differ — local edits stay yours).
FRAMEWORK_FILES=(
  "apps/qa-engine/automation/__init__.py"
  "apps/qa-engine/automation/conftest.py"
  "apps/qa-engine/automation/pages/__init__.py"
  "apps/qa-engine/automation/pages/base_page.py"
  "apps/qa-engine/automation/tests/test_smoke_sample_app.py"
)
for f in "${FRAMEWORK_FILES[@]}"; do
  if [ ! -f "$ROOT/$f" ] && git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git -C "$ROOT" checkout -- "$f"
    say "restored missing framework file from git: $f"
  fi
done

# ---- postgres (Docker, same pgdata volume as docker compose) ----
say "starting postgres in Docker…"
docker compose -f "$ROOT/docker-compose.yml" up -d postgres
for _ in $(seq 1 30); do
  docker compose -f "$ROOT/docker-compose.yml" exec postgres pg_isready -U qa -d qa_v2 >/dev/null 2>&1 && break
  sleep 1
done
say "postgres is ready"

# ---- python env + browsers ----
cd "$ENGINE_DIR"
[ -d .venv ] || { say "creating Python env (uv sync)…"; uv sync --all-extras; }
say "ensuring Playwright Chromium is installed on the host…"
uv run playwright install chromium >/dev/null

# ---- sample-app (:8001) ----
say "starting sample-app on :8001…"
( cd "$ENGINE_DIR" && PYTHONUNBUFFERED=1 \
    uv run python -m uvicorn sample_app.main:app --port 8001 2>&1 \
    | tee "$LOG_DIR/sample-app.log" | logpipe "sample-app" ) &
wait_http "sample-app" "http://localhost:8001/health"

# ---- engine (:8100) — ON THE HOST, so headed browsers are visible ----
say "starting engine on :8100 (host — headed executions open real Chrome)…"
( cd "$ENGINE_DIR" && PYTHONUNBUFFERED=1 \
    ENGINE_TOKEN="$ENGINE_TOKEN" ENGINE_PORT=8100 \
    QA_OLLAMA_BASE_URL="$QA_OLLAMA_BASE_URL" QA_LLM_MODEL="$QA_LLM_MODEL" \
    QA_LLM_CODER_MODEL="$QA_LLM_CODER_MODEL" \
    QA_TARGET_BASE_URL="$QA_TARGET_BASE_URL" QA_ALLOWED_DOMAINS="$QA_ALLOWED_DOMAINS" \
    uv run python -m uvicorn engine.service.main:app --port 8100 2>&1 \
    | tee "$LOG_DIR/engine.log" | logpipe "engine    " ) &
wait_http "engine" "http://localhost:8100/internal/v1/health"

# ---- backend (:4000) — same Postgres DB and secrets as docker compose ----
cd "$BACKEND_DIR"
[ -d node_modules ] || { say "installing backend dependencies…"; npm install; }
say "starting backend on :4000…"
( cd "$BACKEND_DIR" && \
    PORT=4000 DB_DRIVER=postgres \
    DATABASE_URL="postgres://qa:qa@localhost:5432/qa_v2" \
    ENGINE_URL="http://localhost:8100" ENGINE_TOKEN="$ENGINE_TOKEN" \
    JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET" JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET" \
    CORS_ORIGIN="http://localhost:5173" \
    SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
    npm run start:dev 2>&1 | tee "$LOG_DIR/backend.log" | logpipe "backend   " ) &
wait_http "backend" "http://localhost:4000/api/v2/health" 90

# ---- frontend (:5173, Vite dev server) ----
cd "$FRONTEND_DIR"
[ -d node_modules ] || { say "installing frontend dependencies…"; npm install; }
say "starting frontend on :5173…"
( cd "$FRONTEND_DIR" && npm run dev 2>&1 | tee "$LOG_DIR/frontend.log" | logpipe "frontend  " ) &
wait_http "frontend" "http://localhost:5173" 60

echo
say "──────────────────────────────────────────────────────────"
say "everything is up — HEADED executions now open a real Chrome window"
say "  workspace:  http://localhost:5173  ($SEED_ADMIN_EMAIL / $SEED_ADMIN_PASSWORD)"
say "  backend:    http://localhost:4000/api/v2/health"
say "  engine:     http://localhost:8100/internal/v1/health"
say "  sample-app: http://localhost:8001"
say "  logs:       $LOG_DIR/{engine,backend,frontend,sample-app}.log (fresh per launch)"
say "  per-run:    apps/qa-engine/artifacts/<runId>/pytest.log"
say "press Ctrl+C to stop everything"
say "──────────────────────────────────────────────────────────"

wait
