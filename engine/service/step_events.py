"""Live execution step emission for Playwright runs (FR-EXE-006/007/008).

Two coordinated pieces:

1. A pytest plugin (``pytest_*`` hooks below) that emits test-level status
   events (running/passed/failed/skipped) for every test.
2. An ``emit_step`` helper that page objects and an autouse fixture call to
   emit action-level events (navigate/click/fill/assert/screenshot). Values
   are redacted (SEC-007) and sent to the engine's ingest endpoint named by
   the ``QA_EVENT_SINK`` env var; when unset (e.g. plain V1 test runs) every
   emit is a no-op, so instrumentation never breaks standalone execution.

The engine sets ``QA_EVENT_SINK`` and ``QA_RUN_ID`` before launching pytest
with ``-p engine.service.step_events`` (see ``engine/service/execution.py``).
"""

from __future__ import annotations

import os
import time

import httpx

_SINK = os.environ.get("QA_EVENT_SINK", "")
_RUN_ID = os.environ.get("QA_RUN_ID", "")
_SEQ = {"n": 0}
_T0 = {"t": time.time()}

_SECRET_HINTS = ("password", "passwd", "secret", "token", "credential", "pwd")


def _redact(action_type: str, target: str, value: str) -> str:
    """Redact fill values on sensitive fields (SEC-007, FR-EXE-008)."""
    if action_type != "fill":
        return ""
    low = f"{target}".lower()
    if any(h in low for h in _SECRET_HINTS):
        return "***"
    return (value or "")[:60]


def emit_step(
    action_type: str,
    target: str = "",
    value: str = "",
    status: str = "running",
    *,
    test_case_id: str = "",
    test_name: str = "",
    current_url: str = "",
    evidence_uri: str = "",
) -> None:
    """POST one execution.step event to the engine sink (no-op if unset)."""
    if not _SINK:
        return
    _SEQ["n"] += 1
    payload = {
        "run_id": _RUN_ID,
        "test_case_id": test_case_id,
        "test_name": test_name,
        "sequence": _SEQ["n"],
        "action_type": action_type,
        "target": target,
        "value_summary": _redact(action_type, target, value),
        "status": status,
        "current_url": current_url,
        "elapsed_ms": int((time.time() - _T0["t"]) * 1000),
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "evidence_uri": evidence_uri,
    }
    try:
        httpx.post(_SINK, json={"type": "execution.step", "payload": payload}, timeout=2.0)
    except Exception:  # pragma: no cover - telemetry must never fail a test
        pass


# --- pytest plugin: test-level status events -------------------------------


def pytest_runtest_logstart(nodeid, location):  # noqa: D401
    emit_step("test", target=nodeid, status="running", test_name=nodeid)


def pytest_runtest_logreport(report):  # noqa: D401
    if report.when != "call" and not (report.when == "setup" and report.skipped):
        return
    status = "passed" if report.passed else "skipped" if report.skipped else "failed"
    emit_step("test", target=report.nodeid, status=status, test_name=report.nodeid)


# --- autouse fixture: attach page listeners for navigation/errors ----------

try:
    import pytest

    @pytest.fixture(autouse=True)
    def _qa_step_listeners(request):
        """Attach navigation/error listeners to the Playwright page if present."""
        page = None
        if "page" in request.fixturenames:
            page = request.getfixturevalue("page")
        node = request.node.nodeid
        if page is not None:
            page.on(
                "framenavigated",
                lambda frame: (
                    emit_step("navigate", target=frame.url, status="passed",
                              test_name=node, current_url=frame.url)
                    if frame == page.main_frame else None
                ),
            )
            page.on(
                "pageerror",
                lambda exc: emit_step("error", target=str(exc)[:120], status="failed",
                                      test_name=node),
            )
            # Console errors and failed network requests are part of the
            # captured evidence (FR-V3-EXE-010).
            page.on(
                "console",
                lambda msg: (
                    emit_step("error", target=f"console: {msg.text[:150]}",
                              status="failed", test_name=node)
                    if msg.type == "error" else None
                ),
            )
            page.on(
                "requestfailed",
                lambda request: emit_step(
                    "error",
                    target=f"network: {request.url[:120]}",
                    value=str(getattr(request, "failure", "") or "")[:80],
                    status="failed",
                    test_name=node,
                ),
            )
        yield
except Exception:  # pragma: no cover - pytest always present in engine runtime
    pass
