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
import queue
import threading
import time

import httpx

_SINK = os.environ.get("QA_EVENT_SINK", "")
_SINK_TOKEN = os.environ.get("QA_EVENT_SINK_TOKEN", "")
_RUN_ID = os.environ.get("QA_RUN_ID", "")
_SEQ = {"n": 0}
_T0 = {"t": time.time()}

_SECRET_HINTS = ("password", "passwd", "secret", "token", "credential", "pwd")

# Events are shipped by a daemon sender thread so emit_step never blocks the
# Playwright dispatch path (a page spamming console errors must not slow the
# run). The queue is bounded; under backpressure the oldest telemetry is
# dropped rather than stalling test execution.
_QUEUE: queue.Queue[dict] = queue.Queue(maxsize=1000)
_SENDER_STARTED = threading.Event()


def _sender_loop() -> None:
    with httpx.Client(timeout=2.0) as client:
        while True:
            body = _QUEUE.get()
            try:
                client.post(_SINK, json=body, headers={"X-Engine-Token": _SINK_TOKEN})
            except Exception:  # pragma: no cover - telemetry must never fail a test
                pass


def _ensure_sender() -> None:
    if _SENDER_STARTED.is_set():
        return
    _SENDER_STARTED.set()
    threading.Thread(target=_sender_loop, name="qa-step-sender", daemon=True).start()


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
    _ensure_sender()
    body = {"type": "execution.step", "payload": payload}
    try:
        _QUEUE.put_nowait(body)
    except queue.Full:  # pragma: no cover - drop oldest, keep the run moving
        try:
            _QUEUE.get_nowait()
            _QUEUE.put_nowait(body)
        except (queue.Empty, queue.Full):
            pass


# --- pytest plugin: test-level status events -------------------------------


def pytest_sessionfinish(session, exitstatus):  # noqa: D401
    """Give the sender thread a bounded window to flush remaining events."""
    deadline = time.time() + 5.0
    while not _QUEUE.empty() and time.time() < deadline:
        time.sleep(0.05)


def pytest_collection_finish(session):  # noqa: D401
    """Emit the number of collected tests so the live log can show an accurate
    total ("Found N test cases", "Running test 5 of 28"). The count travels in
    ``sequence``; the backend maps ``action_type == "collected"`` to a total."""
    try:
        count = len(session.items)
    except Exception:  # pragma: no cover - defensive: never break collection
        return
    if not _SINK:
        return
    body = {
        "type": "execution.step",
        "payload": {
            "run_id": _RUN_ID,
            "action_type": "collected",
            "target": str(count),
            "sequence": count,
            "status": "passed",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "elapsed_ms": int((time.time() - _T0["t"]) * 1000),
        },
    }
    _ensure_sender()
    try:
        _QUEUE.put_nowait(body)
    except queue.Full:  # pragma: no cover
        pass


def pytest_runtest_logstart(nodeid, location):  # noqa: D401
    emit_step("test", target=nodeid, status="running", test_name=nodeid)


def pytest_runtest_logreport(report):  # noqa: D401
    if report.when != "call" and not (report.when == "setup" and report.skipped):
        return
    status = "passed" if report.passed else "skipped" if report.skipped else "failed"
    emit_step("test", target=report.nodeid, status=status, test_name=report.nodeid)


#: Chromium's error text for a request aborted by a client-side route handler.
#: The only thing that aborts requests in this harness is the allow-list guard
#: in ``automation/conftest.py`` (``route.abort("blockedbyclient")``), so this
#: signature identifies an intentional block rather than a real failure.
_EXPECTED_BLOCK = "ERR_BLOCKED_BY_CLIENT"


def _is_expected_block(text: str) -> bool:
    """True if ``text`` describes a request the allow-list guard blocked (SEC-003)."""
    return _EXPECTED_BLOCK in (text or "").upper()


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
            # captured evidence (FR-V3-EXE-010) — except the ones the domain
            # allow-list guard caused itself. Third-party fonts, images and
            # analytics on a real target are aborted by design (SEC-003), so
            # reporting them as failures buries the actual cause of a failing
            # test under dozens of expected-block lines.
            page.on(
                "console",
                lambda msg: (
                    emit_step("error", target=f"console: {msg.text[:150]}",
                              status="failed", test_name=node)
                    if msg.type == "error" and not _is_expected_block(msg.text) else None
                ),
            )
            page.on(
                "requestfailed",
                lambda request: (
                    emit_step(
                        "error",
                        target=f"network: {request.url[:120]}",
                        value=str(getattr(request, "failure", "") or "")[:80],
                        status="failed",
                        test_name=node,
                    )
                    if not _is_expected_block(str(getattr(request, "failure", "") or ""))
                    else None
                ),
            )
        yield
except Exception:  # pragma: no cover - pytest always present in engine runtime
    pass
