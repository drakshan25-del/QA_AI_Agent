"""QA_AI_Agents engine HTTP service (FR-ENG-001..005).

A separately runnable FastAPI service exposing the versioned ``/internal/v1``
contract the Node.js backend calls. It wraps the existing V1 pure logic
(agents, validators, parsers, execution, reporting) — the engine never owns
the system of record; it receives inputs, returns versioned JSON and streams
events (§6.4, FR-ENG-001/005).

Security: every request requires the ``X-Engine-Token`` header (SEC-002); the
model is only ever invoked through bounded agent functions and never receives
shell access (FR-ENG-004, SEC-005). Correlation IDs propagate on every call
(FR-ENG-003).
"""

from __future__ import annotations

import base64
import hmac
import os
import threading
import time

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from agents import (
    automation_agent,
    report_agent,
    requirement_agent,
    result_analysis_agent,
    test_case_agent,
    test_plan_agent,
)
from app.core.llm import (
    CloudLLMConfigError,
    OllamaUnavailableError,
    check_ollama_health,
    llm_runtime,
    runtime_from_payload,
)
from app.models.schemas import (
    AutomationOutput,
    FailureClassificationOutput,
    RequirementAnalysisOutput,
    TestCasesOutput,
    TestPlanOutput,
    ValidationReport,
)
from app.services.regression import compare_runs
from app.services.report_service import render_report_html, render_report_md
from app.services.validation import validate_generated_code
from engine.contracts.schemas import (
    SCHEMA_VERSION,
    ExecutionPlan,
    ExecutionPlanStep,
    ParsedDocument,
    ParsedSegment,
    ParseResponse,
)
from engine.parsers.excel import ExcelParseError, parse_excel
from engine.service import eventbus, execution
from engine.service.report_adapter import to_report_data
from tools.file_ingestion import IngestionError, parse_document

ENGINE_TOKEN = os.environ.get("ENGINE_TOKEN", "dev-engine-token")
ENGINE_PORT = int(os.environ.get("ENGINE_PORT", "8100"))

app = FastAPI(title="QA_AI_Agents Engine", version=SCHEMA_VERSION)

#: Idempotency cache: key → (stored_at, payload). Bounded and time-limited so
#: a long-lived engine cannot grow it without bound (SEC-012).
_IDEMPOTENCY: dict[str, tuple[float, dict]] = {}
_IDEMPOTENCY_LOCK = threading.Lock()
_IDEMPOTENCY_TTL_SECONDS = 24 * 3600
_IDEMPOTENCY_MAX_KEYS = 1000

_EXCEL_EXTS = (".xlsx", ".xls")


def _auth(token: str | None) -> None:
    """Constant-time comparison of the shared engine token (SEC-002)."""
    if token is None or not hmac.compare_digest(token.encode(), ENGINE_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="invalid or missing X-Engine-Token")


def _idempotent(key: str | None):
    if not key:
        return None
    with _IDEMPOTENCY_LOCK:
        entry = _IDEMPOTENCY.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if time.time() - stored_at > _IDEMPOTENCY_TTL_SECONDS:
            del _IDEMPOTENCY[key]
            return None
        return value


def _remember(key: str | None, value: dict) -> None:
    if not key:
        return
    now = time.time()
    with _IDEMPOTENCY_LOCK:
        # Evict expired entries first, then the oldest if still over the cap.
        expired = [k for k, (t, _) in _IDEMPOTENCY.items() if now - t > _IDEMPOTENCY_TTL_SECONDS]
        for k in expired:
            del _IDEMPOTENCY[k]
        while len(_IDEMPOTENCY) >= _IDEMPOTENCY_MAX_KEYS:
            oldest = min(_IDEMPOTENCY, key=lambda k: _IDEMPOTENCY[k][0])
            del _IDEMPOTENCY[oldest]
        _IDEMPOTENCY[key] = (now, value)


# --- health (§17) ----------------------------------------------------------


@app.get("/internal/v1/health")
def health() -> dict:
    ollama = check_ollama_health()
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
        pw = "ok"
    except Exception as exc:  # noqa: BLE001
        pw = f"error: {exc}"
    return {"status": "ok", "schema_version": SCHEMA_VERSION, "ollama": ollama, "playwright": pw}


# --- document parsing (FR-IN-002/008) --------------------------------------


@app.post("/internal/v1/parse", response_model=ParseResponse)
def parse(
    body: dict = Body(...),
    x_engine_token: str | None = Header(default=None),
    x_correlation_id: str | None = Header(default=None),
) -> ParseResponse:
    _auth(x_engine_token)
    documents: list[ParsedDocument] = []
    for f in body.get("files", []):
        filename = f["filename"]
        category = f.get("category", "user_story")
        try:
            data = base64.b64decode(f["contentBase64"])
        except Exception:
            documents.append(ParsedDocument(filename=filename, category=category, kind="unknown",
                                            parse_status="error", message="invalid base64 content"))
            continue
        ext = os.path.splitext(filename)[1].lower()
        try:
            if ext in _EXCEL_EXTS:
                text, segments, meta = parse_excel(data, filename)
                documents.append(ParsedDocument(
                    filename=filename, category=category, kind="xlsx", text=text,
                    segments=segments, metadata=meta))
            else:
                parsed = parse_document(data, filename)
                segments = [
                    ParsedSegment(
                        page_or_sheet=str(c.get("location", "")).split(" ")[0] if c.get("location") else "",
                        row_or_section=c.get("location", "") or c.get("heading", ""),
                        content=c["text"],
                        metadata={"heading": c.get("heading", ""), "source": c.get("source", filename)},
                    )
                    for c in parsed["chunks"]
                ]
                documents.append(ParsedDocument(
                    filename=filename, category=category, kind=parsed["kind"],
                    text=parsed["text"], segments=segments, metadata=parsed["metadata"]))
        except (IngestionError, ExcelParseError) as exc:
            status = "scanned" if "scanned" in str(exc).lower() else "error"
            documents.append(ParsedDocument(filename=filename, category=category, kind=ext.lstrip("."),
                                            parse_status=status, message=str(exc)))
    return ParseResponse(documents=documents)


# --- agents (FR-RA/TP/TC/AUT) ----------------------------------------------


@app.post("/internal/v1/analyse", response_model=RequirementAnalysisOutput)
def analyse(body: dict = Body(...), x_engine_token: str | None = Header(default=None),
            idempotency_key: str | None = Header(default=None)) -> RequirementAnalysisOutput:
    _auth(x_engine_token)
    cached = _idempotent(idempotency_key)
    if cached:
        return RequirementAnalysisOutput.model_validate(cached)
    try:
        with llm_runtime(runtime_from_payload(body.get("llm"))):
            out = requirement_agent.analyse_requirement(
                body["text"], body.get("acceptanceCriteria", []),
                requirement_id=body.get("requirementId", ""),
                model=body.get("model"), temperature=body.get("temperature"))
    except CloudLLMConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    _remember(idempotency_key, out.model_dump())
    return out


@app.post("/internal/v1/test-plan", response_model=TestPlanOutput)
def test_plan(body: dict = Body(...), x_engine_token: str | None = Header(default=None),
              idempotency_key: str | None = Header(default=None)) -> TestPlanOutput:
    _auth(x_engine_token)
    cached = _idempotent(idempotency_key)
    if cached:
        return TestPlanOutput.model_validate(cached)
    try:
        with llm_runtime(runtime_from_payload(body.get("llm"))):
            out = test_plan_agent.generate_test_plan(
                body["projectName"], body.get("baseUrl", ""), body.get("requirements", []),
                body.get("analyses", []), model=body.get("model"), temperature=body.get("temperature"))
    except CloudLLMConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    _remember(idempotency_key, out.model_dump())
    return out


@app.post("/internal/v1/test-cases", response_model=TestCasesOutput)
def test_cases(body: dict = Body(...), x_engine_token: str | None = Header(default=None),
               idempotency_key: str | None = Header(default=None)) -> TestCasesOutput:
    _auth(x_engine_token)
    cached = _idempotent(idempotency_key)
    if cached:
        return TestCasesOutput.model_validate(cached)
    try:
        with llm_runtime(runtime_from_payload(body.get("llm"))):
            out = test_case_agent.generate_test_cases(
                body["requirement"], body.get("analysis"), min_cases=body.get("minCases", 10),
                model=body.get("model"), temperature=body.get("temperature"))
    except CloudLLMConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    _remember(idempotency_key, out.model_dump())
    return out


@app.post("/internal/v1/automation", response_model=AutomationOutput)
def automation(body: dict = Body(...), x_engine_token: str | None = Header(default=None),
               idempotency_key: str | None = Header(default=None)) -> AutomationOutput:
    _auth(x_engine_token)
    cached = _idempotent(idempotency_key)
    if cached:
        return AutomationOutput.model_validate(cached)
    try:
        with llm_runtime(runtime_from_payload(body.get("llm"))):
            out = automation_agent.generate_automation(
                body["testCases"], body.get("baseUrl", ""), body.get("pageObjectsSummary", ""),
                model=body.get("model"), temperature=body.get("temperature"),
                test_type=body.get("testType", "ui"),
                extra_markers=body.get("extraMarkers"),
                api_summary=body.get("apiSummary", ""))
    except CloudLLMConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    _remember(idempotency_key, out.model_dump())
    return out


# --- validation (FR-VAL) ----------------------------------------------------


@app.post("/internal/v1/validate", response_model=ValidationReport)
def validate(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> ValidationReport:
    _auth(x_engine_token)
    return validate_generated_code(
        body["files"], body.get("allowedDomains", ["localhost", "127.0.0.1"]),
        run_collection=body.get("runCollection", True))


# --- execution plan (FR-AUT-011) -------------------------------------------


@app.post("/internal/v1/execution-plan")
def execution_plan(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> dict:
    _auth(x_engine_token)
    plans: list[ExecutionPlan] = []
    for case in body.get("testCases", []):
        steps: list[ExecutionPlanStep] = []
        seq = 1
        steps.append(ExecutionPlanStep(sequence=seq, action_type="navigate",
                                       target=body.get("baseUrl", ""), description="Open the target page"))
        for step_text in case.get("steps", []):
            seq += 1
            low = str(step_text).lower()
            action = ("fill" if any(w in low for w in ("enter", "type", "fill", "input"))
                      else "click" if any(w in low for w in ("click", "press", "submit", "select"))
                      else "assert" if any(w in low for w in ("verify", "should", "see", "expect", "assert"))
                      else "wait")
            steps.append(ExecutionPlanStep(sequence=seq, action_type=action, target="",
                                           description=str(step_text)))
        for expected in case.get("expected_results", []):
            seq += 1
            steps.append(ExecutionPlanStep(sequence=seq, action_type="assert", target="",
                                           description=str(expected), expected=str(expected)))
        plans.append(ExecutionPlan(test_case_id=case.get("id", ""), case_key=case.get("case_key", ""),
                                   title=case.get("title", ""), steps=steps))
    return {"schema_version": SCHEMA_VERSION, "plans": [p.model_dump() for p in plans]}


# --- regression comparison (UI/API/Regression triad) ------------------------


@app.post("/internal/v1/regression-compare")
def regression_compare(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> dict:
    """Classify a run's per-test results against a baseline run (stateless).

    Body: ``{"baseline": [{node_id, outcome}, ...], "current": [...]}`` — the
    shape ``parse_junit`` produces. Returns transition lists plus a summary
    whose ``has_regressions`` flag is the CI quality-gate signal.
    """
    _auth(x_engine_token)
    baseline = body.get("baseline")
    current = body.get("current")
    if not isinstance(baseline, list) or not isinstance(current, list):
        raise HTTPException(status_code=422, detail="baseline and current must be lists of results")
    return compare_runs(baseline, current)


# --- classification + report (FR-RES/REP) ----------------------------------


@app.post("/internal/v1/classify", response_model=FailureClassificationOutput)
def classify(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> FailureClassificationOutput:
    _auth(x_engine_token)
    try:
        with llm_runtime(runtime_from_payload(body.get("llm"))):
            return result_analysis_agent.classify_failure(body["test"], body.get("context", {}))
    except CloudLLMConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None


@app.post("/internal/v1/render-pdf")
def render_pdf(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> dict:
    """Render HTML to a real PDF via headless Chromium (FR-REP-003/FR-V3-RPT-005).

    The backend has no PDF renderer; the engine already ships Playwright, and
    Chromium's print-to-PDF produces a valid document (AIQA-REPORT-003 — the
    previous behaviour returned HTML bytes labelled application/pdf, which no
    PDF viewer can open).
    """
    _auth(x_engine_token)
    html = str(body.get("html") or "")
    if not html.strip():
        raise HTTPException(status_code=400, detail="html is required")
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.set_content(html, wait_until="load")
                pdf_bytes = page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "16mm", "bottom": "16mm", "left": "12mm", "right": "12mm"},
                )
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001 - caller falls back to HTML export
        raise HTTPException(status_code=503, detail=f"PDF rendering failed: {exc}") from None
    return {"schema_version": SCHEMA_VERSION, "pdfBase64": base64.b64encode(pdf_bytes).decode()}


@app.post("/internal/v1/report")
def report(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> dict:
    _auth(x_engine_token)
    # The V2 backend sends {run_summary, tests, metrics}; the V1 renderers
    # need the full section dict — adapt before rendering (fixes 500s).
    data = to_report_data(body["data"])
    if "ai_narrative" not in data:
        try:
            with llm_runtime(runtime_from_payload(body.get("llm"))):
                summary = report_agent.summarise_run(data.get("run_summary", data))
            data["ai_narrative"] = {"label": "AI-generated narrative", "text": summary}
        except Exception:  # noqa: BLE001 - deterministic fallback (NFR-REL-001)
            data["ai_narrative"] = {"label": "auto-generated (no LLM)", "text": "Narrative unavailable."}
    return {"schema_version": SCHEMA_VERSION, "html": render_report_html(data),
            "md": render_report_md(data), "data": data}


# --- execution with live events (FR-EXE-006) -------------------------------


@app.post("/internal/v1/execute")
def execute(body: dict = Body(...), x_engine_token: str | None = Header(default=None)) -> dict:
    _auth(x_engine_token)
    run_id = body["runId"]
    # Duplicate submits must not spawn a second, uncancellable subprocess for
    # the same run (FR-BE-003 idempotency): report the existing run instead.
    if execution.is_running(run_id):
        return {"runId": run_id, "status": "running",
                "eventsUrl": f"/internal/v1/runs/{run_id}/events", "duplicate": True}
    # allowedDomains may arrive as an array (contract §4) or a CSV string
    # (backend project field); normalise to the CSV the runner env expects.
    raw_domains = body.get("allowedDomains", "localhost,127.0.0.1")
    allowed_domains = ",".join(raw_domains) if isinstance(raw_domains, list) else str(raw_domains)

    # `files` carries approved generated code as [{path, content}] to be
    # materialised in the workspace; plain string entries are treated as
    # pre-existing test paths (backward compatibility).
    raw_files = body.get("files") or []
    file_payloads = [f for f in raw_files if isinstance(f, dict)]
    legacy_paths = [f for f in raw_files if isinstance(f, str)]
    test_paths = list(body.get("testPaths") or legacy_paths)

    def _run():
        execution.run_execution(
            run_id, test_paths,
            files=file_payloads,
            engine_port=ENGINE_PORT, engine_token=ENGINE_TOKEN,
            browser=body.get("browser", "chromium"), headed=body.get("headed", False),
            environment=body.get("environment", "local"),
            target_base_url=body.get("targetBaseUrl", ""),
            target_api_base_url=body.get("targetApiBaseUrl", ""),
            allowed_domains=allowed_domains,
            markers=body.get("markers", ""),
            # V3 runtime settings (FR-V3-EXE-011)
            timeout_seconds=int(body.get("timeoutSeconds") or 900),
            retries=int(body.get("retries") or 0),
            workers=int(body.get("workers") or 1),
            slow_mo_ms=int(body.get("slowMoMs") or 0),
            screenshot_mode=body.get("screenshotMode", "on-failure"),
            video=bool(body.get("video", False)))

    threading.Thread(target=_run, name=f"exec-{run_id}", daemon=True).start()
    return {"runId": run_id, "status": "running", "eventsUrl": f"/internal/v1/runs/{run_id}/events"}


@app.post("/internal/v1/executions/{run_id}/cancel")
def cancel(run_id: str, x_engine_token: str | None = Header(default=None)) -> dict:
    _auth(x_engine_token)
    return {"runId": run_id, "cancelled": execution.cancel_execution(run_id)}


@app.post("/internal/v1/runs/{run_id}/_ingest")
async def ingest_step(
    run_id: str,
    request: Request,
    x_engine_token: str | None = Header(default=None),
    token: str = "",
) -> dict:
    """Receive a step event from the running pytest process and republish it.

    The token travels in the ``X-Engine-Token`` header (the query parameter is
    accepted for backward compatibility only — headers never end up in access
    logs, SEC-002/007).
    """
    _auth(x_engine_token or token or None)
    event = await request.json()
    eventbus.emit(run_id, event.get("type", "execution.step"), event.get("payload", {}))
    return {"ok": True}


@app.get("/internal/v1/runs/{run_id}/events")
def run_events(run_id: str, x_engine_token: str | None = Header(default=None), from_seq: int = 0):
    """SSE stream of ordered execution events for a run (FR-ENG-003)."""
    _auth(x_engine_token)

    def _gen():
        import json
        for env in eventbus.stream(run_id, from_seq=from_seq):
            yield f"id: {env['seq']}\nevent: {env['type']}\ndata: {json.dumps(env['payload'])}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")
