#!/usr/bin/env bash
# demo-preflight.sh — one command that proves the live demo will work.
#
# Run this BEFORE going on stage. It checks, in order:
#   1. every service is up (backend, engine, sample-app, frontend)
#   2. the automation workspace's framework files are intact
#   3. both generation grounding sources respond (page DOM + OpenAPI spec)
#   4. the LLM runtime is reachable (local Ollama; cloud keys are flagged
#      for a manual one-generation check — there is no cheap ping)
#   5. every approved suite in the demo projects EXECUTES GREEN through the
#      real pipeline (materialise → pytest → results), headless
#
# Usage:
#   ./demo-preflight.sh                     # checks all projects with suites
#   ./demo-preflight.sh <projectId> ...     # only these projects
#   ./demo-preflight.sh --with-generation   # + one real LLM generation smoke
#
# Exit code 0 = everything green. Anything else: fix before presenting.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BACKEND_URL:=http://localhost:4000}"
: "${ENGINE_URL:=http://localhost:8100}"
: "${TARGET_URL:=http://localhost:8001}"
: "${FRONTEND_URL:=http://localhost:5173}"
: "${ADMIN_EMAIL:=rakshandangol93@gmail.com}"
: "${ADMIN_PASSWORD:=In-Silence-2026}"

mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/preflight.log"
: > "$LOG"

PASS=0; FAIL=0
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*" | tee -a "$LOG"; PASS=$((PASS+1)); }
bad()  { printf '\033[1;31m  ✘ %s\033[0m\n' "$*" | tee -a "$LOG"; FAIL=$((FAIL+1)); }
note() { printf '\033[1;33m  ▲ %s\033[0m\n' "$*" | tee -a "$LOG"; }
head_() { printf '\033[1;36m%s\033[0m\n' "$*" | tee -a "$LOG"; }

WITH_GENERATION=0
PROJECT_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --with-generation) WITH_GENERATION=1 ;;
    *) PROJECT_ARGS+=("$arg") ;;
  esac
done

head_ "── 1. Services ────────────────────────────────────────────"
check_http() { # name url
  if curl -fsS -o /dev/null --max-time 5 "$2" 2>>"$LOG"; then ok "$1 ($2)"; else bad "$1 unreachable ($2)"; fi
}
check_http "backend"    "$BACKEND_URL/api/v2/health"
check_http "engine"     "$ENGINE_URL/internal/v1/health"
check_http "sample-app" "$TARGET_URL/health"
check_http "frontend"   "$FRONTEND_URL"

head_ "── 2. Automation workspace integrity ──────────────────────"
# Stale-engine check: generation gates only exist in the running engine
# process — an engine older than the newest agents/engine code silently
# generates without them (that is how the /users/create incident shipped).
ENGINE_PID=$(lsof -nP -iTCP:8100 -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -n "$ENGINE_PID" ]; then
  ENGINE_START=$(ps -o lstart= -p "$ENGINE_PID" 2>/dev/null | xargs -I{} date -j -f "%a %b %d %T %Y" "{}" +%s 2>/dev/null)
  NEWEST_CODE=$(find "$ROOT/apps/qa-engine/agents" "$ROOT/apps/qa-engine/engine" -name "*.py" -exec stat -f "%m" {} + 2>/dev/null | sort -rn | head -1)
  if [ -n "$ENGINE_START" ] && [ -n "$NEWEST_CODE" ] && [ "$ENGINE_START" -lt "$NEWEST_CODE" ]; then
    bad "engine is running STALE code (started before the newest engine/agents change) — restart ./run-headed.sh"
  else
    ok "engine process is newer than the engine/agents code"
  fi
fi
for f in \
  "apps/qa-engine/automation/__init__.py" \
  "apps/qa-engine/automation/conftest.py" \
  "apps/qa-engine/automation/pages/__init__.py" \
  "apps/qa-engine/automation/pages/base_page.py"; do
  if [ -f "$ROOT/$f" ]; then ok "$f"; else bad "$f MISSING — run ./run-headed.sh (self-heals) or: git checkout -- $f"; fi
done

head_ "── 3. Generation grounding sources ────────────────────────"
GROUND=$(cd "$ROOT/apps/qa-engine" && uv run python - "$TARGET_URL" 2>>"$LOG" <<'PYEOF'
import sys
from agents.page_inspector import collect_page_structures
from agents.api_inspector import collect_api_surface
target = sys.argv[1]
snap = collect_page_structures(target, ["/login"])
inv = snap.structures.get("/login")
print("DOM_OK" if inv and (inv.inputs or inv.buttons) else "DOM_FAIL")
surface = collect_api_surface(target)
print(f"OPENAPI_OK {len(surface.endpoints)}" if surface else "OPENAPI_FAIL")
PYEOF
)
echo "$GROUND" | grep -q "DOM_OK" \
  && ok "page DOM distills ($TARGET_URL/login → inputs/buttons found)" \
  || bad "page DOM grounding failed — UI generation would be ungrounded"
echo "$GROUND" | grep -q "OPENAPI_OK" \
  && ok "OpenAPI spec parses ($(echo "$GROUND" | grep OPENAPI_OK | cut -d' ' -f2) endpoints)" \
  || bad "OpenAPI grounding failed — API generation would be ungrounded"

head_ "── 4–5. LLM runtime + approved suites execute green ───────"
PYARGS=("$BACKEND_URL" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$WITH_GENERATION")
[ ${#PROJECT_ARGS[@]} -gt 0 ] && PYARGS+=("${PROJECT_ARGS[@]}")
python3 - "${PYARGS[@]}" 2>>"$LOG" <<'PYEOF' | tee -a "$LOG"
import json, sys, time, urllib.request, urllib.error

base, email, password, with_gen = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
only_projects = set(sys.argv[5:])
API = base + "/api/v2"
GREEN, RED, YELLOW = "\033[1;32m  ✔ %s\033[0m", "\033[1;31m  ✘ %s\033[0m", "\033[1;33m  ▲ %s\033[0m"
failures = 0

def req(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(API + path, method=method, headers=headers,
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}

try:
    login = req("POST", "/auth/login", {"email": email, "password": password})
    token = login.get("accessToken") or login.get("access_token") or login.get("token")
    assert token
    print(GREEN % "backend login as admin")
except Exception as exc:
    print(RED % f"backend login failed: {exc}")
    sys.exit(1)

projects = req("GET", "/projects", token=token)
ollama_models: set | None = None

for p in projects:
  try:
    pid = p["id"]
    if only_projects and pid not in only_projects:
        continue
    arts = req("GET", f"/projects/{pid}/automation", token=token)
    eligible = [a for a in arts if a["status"] == "active" and a["approvalStatus"] == "approved"
                and a["validationStatus"] in ("passed", "passed_with_warnings", "overridden")]
    tests = [a for a in eligible if a["kind"] == "test_file"]
    if not tests:
        continue
    label = f"{p.get('name', pid)} ({len(tests)} suite file(s))"

    # Overridden validations are how every broken suite reached the stage so
    # far — surface them loudly.
    overridden = [a["path"].rsplit("/", 1)[-1] for a in eligible
                  if a.get("validationStatus") == "overridden"]
    if overridden:
        print(YELLOW % f"{label}: validation OVERRIDDEN on {', '.join(overridden)} — re-validate to a clean pass before presenting")

    # LLM readiness for this project
    if p.get("llmType") == "LOCAL":
        if ollama_models is None:
            try:
                with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=5) as r:
                    ollama_models = {m["name"] for m in json.load(r).get("models", [])}
            except Exception:
                ollama_models = set()
        print((GREEN if ollama_models else RED) % f"{label}: local LLM (Ollama {'reachable' if ollama_models else 'UNREACHABLE'})")
        if not ollama_models:
            failures += 1
    else:
        print(YELLOW % f"{label}: cloud LLM ({p.get('cloudModel')}) — key not pingable; run one generation before going live (or use --with-generation)")

    # Execute every approved suite through the real pipeline, headless
    TERMINAL = ("completed", "passed", "partially_passed", "failed", "error",
                "cancelled", "timed_out")
    try:
        run = req("POST", "/executions", {
            "projectId": pid,
            "automationIds": [a["id"] for a in eligible],
        }, token=token)
        run_id = run.get("id") or (run.get("run") or {}).get("id")
        assert run_id, f"no run id in {run}"
        status, metrics = "", {}
        for _ in range(120):
            time.sleep(2)
            state = req("GET", f"/executions/{run_id}", token=token)
            inner = state.get("run") or state
            status = inner.get("status", "")
            metrics = inner.get("metrics") or {}
            if status in TERMINAL:
                break
        passed, failed = metrics.get("passed", 0), metrics.get("failed", 0)
        if status in ("completed", "passed") and failed == 0 and passed > 0:
            print(GREEN % f"{label}: execution green — {passed} passed, 0 failed")
        else:
            print(RED % f"{label}: execution NOT green — status={status} passed={passed} failed={failed} error={str(metrics.get('error',''))[:160]}")
            failures += 1
    except Exception as exc:
        print(RED % f"{label}: execution request failed: {exc}")
        failures += 1
        continue  # one project's hiccup must not abort the rest of the sweep

    # Optional real generation smoke (costs one LLM call per project type)
    if with_gen:
        try:
            cases = req("GET", f"/projects/{pid}/test-cases", token=token)
            cases = cases if isinstance(cases, list) else cases.get("items", [])
            approved = [c for c in cases if c.get("status") == "approved"]
            if not approved:
                print(YELLOW % f"{label}: no approved test cases — generation smoke skipped")
            else:
                job = req("POST", f"/projects/{pid}/automation/generate",
                          {"testCaseIds": [approved[0]["id"]], "draftPreview": True}, token=token)
                jid = job.get("jobId") or job.get("id")
                jstatus = ""
                for _ in range(90):
                    time.sleep(2)
                    j = req("GET", f"/jobs/{jid}", token=token)
                    jstatus = j.get("status", "")
                    if jstatus in ("completed", "succeeded", "failed", "error"):
                        break
                if jstatus in ("completed", "succeeded"):
                    print(GREEN % f"{label}: generation smoke (draft preview) succeeded")
                else:
                    print(RED % f"{label}: generation smoke ended '{jstatus}'")
                    failures += 1
        except Exception as exc:
            print(RED % f"{label}: generation smoke failed: {exc}")
            failures += 1
  except Exception as exc:
    print(RED % f"{p.get('name', p.get('id', '?'))}: project check crashed: {exc}")
    failures += 1

sys.exit(1 if failures else 0)
PYEOF
PYRC=$?
[ $PYRC -eq 0 ] || FAIL=$((FAIL+1))

echo | tee -a "$LOG"
if [ $FAIL -eq 0 ]; then
  printf '\033[1;32m✔ PREFLIGHT GREEN — %d checks passed. Break a leg.\033[0m\n' "$PASS" | tee -a "$LOG"
  exit 0
else
  printf '\033[1;31m✘ PREFLIGHT FAILED — %d problem(s). Details above and in logs/preflight.log\033[0m\n' "$FAIL" | tee -a "$LOG"
  exit 1
fi
