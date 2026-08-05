"""Shared types, stages, defaults and limits for the UI Scanner agent.

The UI Scanner opens a target application with Playwright, discovers the
elements that matter for test automation, generates several locator candidates
per element, validates every candidate against the live page and ranks them.

Design rules that the rest of the package depends on:

* A locator is always represented twice — ``expression`` (displayable
  Playwright code) and ``locator_data`` (machine-readable). Only
  ``locator_data`` is ever executed, by rebuilding the locator through the
  Playwright API; ``expression`` is never ``eval``'d (SEC-005).
* Nothing that looks like a credential leaves this package: password-typed
  inputs contribute metadata only, and every captured value passes through
  :func:`engine.uiscanner.redaction.safe_value`.
* Stage names are a closed vocabulary shared verbatim with the backend
  (``common/enums.ts``) and the React UI, so all three speak one language.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

#: Bumped when the UI-scan wire payload changes (backend pins this).
UI_SCAN_SCHEMA_VERSION = "v1"

#: Temporary attribute stamped on every discovered element so a candidate
#: locator can be proven to resolve to *that* element and not a look-alike.
#: Removed from the page again before the scan finishes (see scanner.py).
UID_ATTRIBUTE = "data-qa-scan-uid"

# --- lifecycle -------------------------------------------------------------

#: Ordered scan lifecycle. Terminal states are the last three.
UI_SCAN_STAGES: tuple[str, ...] = (
    "IDLE",
    "QUEUED",
    "STARTING_BROWSER",
    "NAVIGATING",
    "AUTHENTICATING",
    "WAITING_FOR_PAGE",
    "SCANNING_DOM",
    "SCANNING_FRAMES",
    "CAPTURING_ACCESSIBILITY",
    "GENERATING_LOCATORS",
    "VALIDATING_LOCATORS",
    "CAPTURING_SCREENSHOT",
    "SAVING_RESULTS",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
)

TERMINAL_STAGES = frozenset({"COMPLETED", "CANCELLED", "FAILED"})

#: Determinate progress (0-100) reported when each stage begins, so the UI
#: reflects real backend work instead of a simulated timer.
STAGE_PROGRESS: dict[str, int] = {
    "QUEUED": 0,
    "STARTING_BROWSER": 5,
    "NAVIGATING": 12,
    "AUTHENTICATING": 20,
    "WAITING_FOR_PAGE": 28,
    "SCANNING_DOM": 35,
    "SCANNING_FRAMES": 45,
    "CAPTURING_ACCESSIBILITY": 55,
    "GENERATING_LOCATORS": 62,
    "VALIDATING_LOCATORS": 70,
    "CAPTURING_SCREENSHOT": 92,
    "SAVING_RESULTS": 96,
    "COMPLETED": 100,
    "CANCELLED": 100,
    "FAILED": 100,
}

LogLevel = Literal["debug", "info", "warning", "error", "success"]

Strategy = Literal[
    "role",
    "label",
    "testId",
    "placeholder",
    "text",
    "scopedRole",
    "name",
    "css",
    "xpath",
]

#: Locator strategies considered semantic for the research metrics (§29).
SEMANTIC_STRATEGIES = frozenset({"role", "label", "placeholder", "text", "scopedRole"})

# --- limits (every one is a hard stop, never a suggestion) -----------------

DEFAULT_TIMEOUT_MS = 45_000
MAX_TIMEOUT_MS = 300_000
DEFAULT_MAX_ELEMENTS = 250
MAX_MAX_ELEMENTS = 1_000
#: Frames traversed per scan, including the main frame.
MAX_FRAMES = 12
#: Pages visited in one crawl. A scanner that wanders an application without a
#: ceiling is a crawler, and a crawler against a production app is an incident.
MAX_PAGES = 25
#: Candidates generated per element before scoring truncates the list.
MAX_CANDIDATES_PER_ELEMENT = 9
#: Full-page screenshots above this size are dropped with a warning.
MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
#: ARIA snapshots above this size are truncated with a warning.
MAX_SNAPSHOT_CHARS = 400_000
#: Elements handed to the LLM fallback in one scan (bounded cost, §17).
MAX_LLM_FALLBACKS = 12
#: Per-locator validation budget; a pathological selector cannot stall a scan.
VALIDATION_TIMEOUT_MS = 2_000

# --- element discovery ------------------------------------------------------

#: Interactive/test-relevant elements (§6). Deliberately not "every DOM node".
CANDIDATE_SELECTORS: tuple[str, ...] = (
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "a[href]",
    "summary",
    "details",
    "label",
    "[role]",
    "[aria-label]",
    "[aria-labelledby]",
    "[data-testid]",
    "[data-test]",
    "[data-cy]",
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
)

#: Structural containers used to scope ambiguous locators (§13).
CONTAINER_SELECTORS: tuple[str, ...] = (
    "form",
    "fieldset",
    "dialog",
    "table",
    "tr",
    "ul",
    "ol",
    "li",
    "nav",
    "main",
    "section",
    "article",
    "menu",
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="region"]',
    '[role="navigation"]',
    '[role="main"]',
    '[role="tabpanel"]',
    '[role="menu"]',
    '[role="list"]',
    '[role="listitem"]',
    '[role="row"]',
)


# --- structures -------------------------------------------------------------


@dataclass(slots=True)
class FrameDefinition:
    """Where an element lives, as a rebuildable chain of frame selectors."""

    #: Ordered iframe selectors from the main document down to the element.
    path: list[str] = field(default_factory=list)
    url: str = ""
    name: str = ""
    title: str = ""
    #: Selector of the iframe itself ('' for the main document).
    selector: str = ""
    #: Index of the parent frame in the scan's frame list; -1 for main.
    parent_index: int = -1
    index: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": list(self.path),
            "url": self.url,
            "name": self.name,
            "title": self.title,
            "selector": self.selector,
            "parentIndex": self.parent_index,
            "index": self.index,
        }


@dataclass(slots=True)
class LocatorCandidate:
    """One generated, validated and scored locator for a single element."""

    id: str
    strategy: Strategy
    #: Displayable Playwright code (TypeScript form, as shown in the UI).
    expression: str
    #: The same locator in the sync-Python form this project generates tests in.
    python_expression: str
    locator_data: dict[str, Any]
    base_score: float
    final_score: float = 0.0
    confidence: float = 0.0
    match_count: int = -1
    unique: bool = False
    valid: bool = False
    visible_match: bool | None = None
    enabled_match: bool | None = None
    role_match: bool | None = None
    name_match: bool | None = None
    identity_match: bool | None = None
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    source: Literal["deterministic-scanner", "llm-fallback", "manual"] = (
        "deterministic-scanner"
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "strategy": self.strategy,
            "expression": self.expression,
            "pythonExpression": self.python_expression,
            "locatorData": self.locator_data,
            "baseScore": round(self.base_score, 2),
            "finalScore": round(self.final_score, 2),
            "confidence": round(self.confidence, 4),
            "matchCount": self.match_count,
            "unique": self.unique,
            "valid": self.valid,
            "visibleMatch": self.visible_match,
            "enabledMatch": self.enabled_match,
            "roleMatch": self.role_match,
            "nameMatch": self.name_match,
            "identityMatch": self.identity_match,
            "reasons": list(self.reasons),
            "warnings": list(self.warnings),
            "source": self.source,
        }


@dataclass(slots=True)
class ScanOptions:
    """Validated options for one scan (mirrors StartUiScanDto on the backend)."""

    url: str
    browser: str = "chromium"
    headless: bool = True
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    max_elements: int = DEFAULT_MAX_ELEMENTS
    include_hidden: bool = False
    #: Pages to visit by following in-app links; 1 scans only the target page.
    max_pages: int = 1
    capture_screenshot: bool = True
    capture_accessibility: bool = True
    scan_frames: bool = True
    allowed_hosts: list[str] = field(default_factory=list)
    allow_private_network: bool = False
    #: Optional deterministic pre-scan interactions (§15).
    pre_scan_actions: list[dict[str, Any]] = field(default_factory=list)
    #: Login form credentials; used once, never logged, never persisted (§16).
    username: str = ""
    password: str = ""
    login_url: str = ""
    #: Opaque Playwright storage state supplied by the backend (§16). The
    #: engine never reads it from disk and never returns it to any caller.
    storage_state: dict[str, Any] | None = None
    #: Project LLM for the bounded fallback (§17); empty disables it.
    model: str = ""
    temperature: float = 0.1
    use_llm_fallback: bool = True
    correlation_id: str = ""

    def sanitised(self) -> dict[str, Any]:
        """Options safe to echo into logs and events (no credentials)."""
        return {
            "url": self.url,
            "browser": self.browser,
            "headless": self.headless,
            "timeoutMs": self.timeout_ms,
            "maxElements": self.max_elements,
            "maxPages": self.max_pages,
            "includeHidden": self.include_hidden,
            "captureScreenshot": self.capture_screenshot,
            "captureAccessibility": self.capture_accessibility,
            "scanFrames": self.scan_frames,
            "authenticated": bool(self.username or self.storage_state),
            "model": self.model,
            "useLlmFallback": self.use_llm_fallback,
        }


class UiScanCancelled(Exception):
    """Raised at a checkpoint when the caller requested cancellation."""


class UiScanError(Exception):
    """A scan failure with a stable machine code the frontend can map (§27)."""

    def __init__(
        self,
        code: str,
        message: str,
        stage: str = "FAILED",
        recoverable: bool = True,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.stage = stage
        self.recoverable = recoverable

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "stage": self.stage,
            "recoverable": self.recoverable,
        }
