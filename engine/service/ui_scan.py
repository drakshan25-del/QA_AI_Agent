"""Engine-side lifecycle for UI scans (§24 browser lifecycle, §23 limits).

Mirrors :mod:`engine.service.execution`: the HTTP layer accepts a scan, this
module runs it on a worker thread and publishes ordered events onto the shared
:mod:`engine.service.eventbus` so the backend can stream them over SSE and
re-broadcast them to the browser.

Lifecycle guarantees:

* ``eventbus.close`` always runs, so an SSE consumer never hangs on a crashed
  worker;
* a scan id already running is refused rather than started twice, so a
  duplicate submit cannot spawn a second uncancellable browser;
* cancellation is cooperative — the flag is checked at every scan checkpoint,
  and the scanner's ``finally`` closes the browser;
* results are retained briefly for the backend to collect, under a bounded
  cache so a long-lived engine cannot grow without limit (SEC-012).
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from app.core.logging import get_logger
from engine.service import eventbus
from engine.uiscanner.scanner import run_scan
from engine.uiscanner.types import (
    DEFAULT_MAX_ELEMENTS,
    DEFAULT_TIMEOUT_MS,
    MAX_MAX_ELEMENTS,
    MAX_PAGES,
    MAX_TIMEOUT_MS,
    ScanOptions,
)

logger = get_logger(__name__)

#: Concurrent scans this engine will run; each one owns a browser process.
MAX_CONCURRENT_SCANS = int(os.environ.get("UI_SCAN_MAX_CONCURRENT", "2"))

#: How long a finished scan's result stays collectable, and how many are kept.
RESULT_TTL_SECONDS = 30 * 60
MAX_RETAINED_RESULTS = 50

_LOCK = threading.Lock()
_RUNNING: dict[str, threading.Event] = {}
_RESULTS: dict[str, tuple[float, dict[str, Any]]] = {}


class ScanCapacityError(RuntimeError):
    """Raised when the engine is already running its maximum scans."""


def is_running(scan_id: str) -> bool:
    with _LOCK:
        return scan_id in _RUNNING


def active_count() -> int:
    with _LOCK:
        return len(_RUNNING)


def cancel_scan(scan_id: str) -> bool:
    """Request cooperative cancellation; ``False`` when nothing is running."""
    with _LOCK:
        flag = _RUNNING.get(scan_id)
    if flag is None:
        return False
    flag.set()
    return True


def take_result(scan_id: str) -> dict[str, Any] | None:
    """Return and forget a finished scan's result (single collection)."""
    with _LOCK:
        entry = _RESULTS.pop(scan_id, None)
    return entry[1] if entry else None


def peek_result(scan_id: str) -> dict[str, Any] | None:
    with _LOCK:
        entry = _RESULTS.get(scan_id)
    return entry[1] if entry else None


def _store_result(scan_id: str, result: dict[str, Any]) -> None:
    now = time.time()
    with _LOCK:
        for key in [k for k, (t, _) in _RESULTS.items() if now - t > RESULT_TTL_SECONDS]:
            del _RESULTS[key]
        while len(_RESULTS) >= MAX_RETAINED_RESULTS:
            oldest = min(_RESULTS, key=lambda k: _RESULTS[k][0])
            del _RESULTS[oldest]
        _RESULTS[scan_id] = (now, result)


def build_options(body: dict[str, Any]) -> ScanOptions:
    """Validate and clamp a scan request into :class:`ScanOptions`.

    Every limit is clamped rather than trusted: the backend validates too, but
    the engine must stay safe when called directly.
    """
    browser = str(body.get("browser") or "chromium").lower()
    if browser not in {"chromium", "firefox", "webkit"}:
        raise ValueError(f"unsupported browser '{browser}'")
    timeout_ms = int(body.get("timeoutMs") or DEFAULT_TIMEOUT_MS)
    max_elements = int(body.get("maxElements") or DEFAULT_MAX_ELEMENTS)
    max_pages = int(body.get("maxPages") or 1)
    allowed = body.get("allowedHosts") or []
    if isinstance(allowed, str):
        allowed = [h.strip() for h in allowed.split(",") if h.strip()]

    return ScanOptions(
        url=str(body.get("url") or "").strip(),
        browser=browser,
        headless=bool(body.get("headless", True)),
        timeout_ms=max(5_000, min(timeout_ms, MAX_TIMEOUT_MS)),
        max_elements=max(1, min(max_elements, MAX_MAX_ELEMENTS)),
        max_pages=max(1, min(max_pages, MAX_PAGES)),
        include_hidden=bool(body.get("includeHidden", False)),
        capture_screenshot=bool(body.get("captureScreenshot", True)),
        capture_accessibility=bool(body.get("captureAccessibility", True)),
        scan_frames=bool(body.get("scanFrames", True)),
        allowed_hosts=list(allowed),
        allow_private_network=bool(body.get("allowPrivateNetwork", False)),
        pre_scan_actions=list(body.get("preScanActions") or []),
        username=str(body.get("username") or ""),
        password=str(body.get("password") or ""),
        login_url=str(body.get("loginUrl") or "").strip(),
        storage_state=body.get("storageState") or None,
        model=str(body.get("model") or ""),
        temperature=float(body.get("temperature") or 0.1),
        use_llm_fallback=bool(body.get("useLlmFallback", True)),
        correlation_id=str(body.get("correlationId") or ""),
    )


def start_scan(scan_id: str, options: ScanOptions) -> dict[str, Any]:
    """Start a scan on a worker thread; returns the acknowledgement payload.

    Raises:
        ScanCapacityError: When the engine already runs its maximum scans.
    """
    with _LOCK:
        if scan_id in _RUNNING:
            return {
                "scanId": scan_id,
                "status": "running",
                "eventsUrl": f"/internal/v1/runs/{scan_id}/events",
                "duplicate": True,
            }
        if len(_RUNNING) >= MAX_CONCURRENT_SCANS:
            raise ScanCapacityError(
                f"The engine is already running {len(_RUNNING)} UI scan(s); "
                f"the limit is {MAX_CONCURRENT_SCANS}. Try again shortly."
            )
        cancel_flag = threading.Event()
        _RUNNING[scan_id] = cancel_flag

    eventbus.emit(
        scan_id,
        "ui_scan.status",
        {"stage": "QUEUED", "progress": 0, "message": "Scan accepted by the engine"},
    )

    def _worker() -> None:
        try:
            result = run_scan(
                options,
                emit=lambda event_type, payload: eventbus.emit(
                    scan_id, event_type, payload
                ),
                is_cancelled=cancel_flag.is_set,
            )
        except Exception as exc:  # noqa: BLE001 - never leave the stream open
            logger.exception("ui scan %s crashed", scan_id)
            result = {
                "status": "FAILED",
                "error": {
                    "code": "UI_SCAN_ENGINE_ERROR",
                    "message": f"The scan failed unexpectedly: {exc}",
                    "stage": "FAILED",
                    "recoverable": True,
                },
                "elements": [],
                "frames": [],
                "warnings": [],
                "metrics": {},
            }
            eventbus.emit(
                scan_id,
                "ui_scan.status",
                {
                    "stage": "FAILED",
                    "progress": 100,
                    "message": result["error"]["message"],
                },
            )
        finally:
            with _LOCK:
                _RUNNING.pop(scan_id, None)

        _store_result(scan_id, result)
        # The result itself is collected over HTTP: a full-page screenshot has
        # no business travelling through the event stream.
        eventbus.emit(
            scan_id,
            "ui_scan.finished",
            {
                "status": result.get("status", "FAILED"),
                "totalElements": len(result.get("elements", [])),
                "resultUrl": f"/internal/v1/ui-scans/{scan_id}/result",
            },
        )
        eventbus.close(scan_id)

    threading.Thread(target=_worker, name=f"ui-scan-{scan_id}", daemon=True).start()
    return {
        "scanId": scan_id,
        "status": "running",
        "eventsUrl": f"/internal/v1/runs/{scan_id}/events",
    }
