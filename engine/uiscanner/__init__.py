"""UI Scanner agent: deterministic Playwright-based locator discovery.

Public entry point is :func:`engine.uiscanner.scanner.run_scan`; the engine
HTTP layer drives it through :mod:`engine.service.ui_scan`.
"""

from engine.uiscanner.types import (
    UI_SCAN_SCHEMA_VERSION,
    UI_SCAN_STAGES,
    ScanOptions,
    UiScanCancelled,
    UiScanError,
)

__all__ = [
    "UI_SCAN_SCHEMA_VERSION",
    "UI_SCAN_STAGES",
    "ScanOptions",
    "UiScanCancelled",
    "UiScanError",
]
