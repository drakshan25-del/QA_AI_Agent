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

#: Action types whose ``value`` carries diagnostic text (a failure reason or
#: an HTTP status line) rather than user input, so it is summarised instead of
#: dropped. ``api`` events are emitted per request by the ``api_client``
#: fixture; their value is only ever "HTTP <status> <reason>", never a payload.
_DIAGNOSTIC_ACTIONS = ("test", "error", "api")

#: Chromium's error text for a request the SEC-003 domain allow-list guard
#: aborted (``route.abort("blockedbyclient")`` in ``automation/conftest.py``).
#: Those aborts are the guard working as designed — every third-party font,
#: analytics and CDN request on an external target produces one — so they are
#: reported as ``blocked``, never ``failed``. Emitting them as failures floods
#: the live log with ERROR lines and, worse, overwrites the real per-test
#: failure reason with an unrelated asset URL.
_GUARD_BLOCKED = "ERR_BLOCKED_BY_CLIENT"

#: Chromium prefixes every console message about an asset that did not load
#: with this text (e.g. "Failed to load resource: the server responded with a
#: status of 409"). Those messages are page-side resource noise (trackers,
#: beacons, HTTP errors on assets), never a test defect — the authoritative
#: failure reason comes from pytest's crash repr. They are emitted as
#: ``warning`` so they stay in the event timeline as evidence without
#: producing ERROR log lines or displacing the real failure reason.
_RESOURCE_NOISE = "Failed to load resource"

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
    """Redact fill values on sensitive fields (SEC-007, FR-EXE-008).

    Diagnostic actions carry a failure reason rather than user input, so their
    value is kept (truncated) — that reason is what the live log shows when a
    test fails. The backend redacts log text again before persisting it.
    """
    if action_type in _DIAGNOSTIC_ACTIONS:
        return (value or "")[:200]
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


def _crash_reason(report) -> str:
    """One-line reason a test failed, taken from pytest's own crash repr.

    This is the authoritative failure cause (e.g. ``AttributeError: ...``,
    ``TimeoutError: Locator.click: ...``). Without it the backend can only
    guess from whatever error the page happened to emit last, which is why
    real assertion failures used to be reported as unrelated console noise.
    """
    longrepr = getattr(report, "longrepr", None)
    message = getattr(getattr(longrepr, "reprcrash", None), "message", "") or ""
    if not message:
        message = str(longrepr or "")
    lines = [ln.strip() for ln in message.splitlines() if ln.strip()]
    return lines[0][:200] if lines else ""


def _skip_reason(report) -> str:
    """Why a test was skipped (e.g. 'target app not running').

    pytest's skip longrepr is a ``(path, lineno, "Skipped: <reason>")``
    tuple; without the reason an all-skipped run reads as a mystery in the
    live log (NFR-USA-002).
    """
    longrepr = getattr(report, "longrepr", None)
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        reason = str(longrepr[2])
        return reason.removeprefix("Skipped: ")[:200]
    return ""


def pytest_runtest_logreport(report):  # noqa: D401
    if report.when != "call" and not (report.when == "setup" and report.skipped):
        return
    status = "passed" if report.passed else "skipped" if report.skipped else "failed"
    value = ""
    if status == "failed":
        value = _crash_reason(report)
    elif status == "skipped":
        value = _skip_reason(report)
    emit_step(
        "test",
        target=report.nodeid,
        value=value,
        status=status,
        test_name=report.nodeid,
    )


# --- autouse fixture: attach page listeners for navigation/errors ----------


def _emit_request_failed(request, node: str) -> None:
    """Emit a failed network request, distinguishing guard aborts from defects."""
    failure = str(getattr(request, "failure", "") or "")
    emit_step(
        "error",
        target=f"network: {request.url[:120]}",
        value=failure[:80],
        status="blocked" if _GUARD_BLOCKED in failure else "failed",
        test_name=node,
    )

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
            # captured evidence (FR-V3-EXE-010). Both are still emitted when
            # the allow-list guard caused them, but as ``blocked`` rather than
            # ``failed`` — kept in the timeline, kept out of the failure log.
            page.on(
                "console",
                lambda msg: (
                    emit_step(
                        "error",
                        target=f"console: {msg.text[:150]}",
                        status=(
                            "blocked" if _GUARD_BLOCKED in msg.text
                            else "warning" if msg.text.startswith(_RESOURCE_NOISE)
                            else "failed"
                        ),
                        test_name=node,
                    )
                    if msg.type == "error" else None
                ),
            )
            page.on("requestfailed", lambda req: _emit_request_failed(req, node))
        yield
except Exception:  # pragma: no cover - pytest always present in engine runtime
    pass
