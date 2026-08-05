"""UI Scanner orchestration: one real Playwright scan from launch to result.

Walks the closed stage vocabulary in :mod:`engine.uiscanner.types`, emitting a
status event and human log lines at every step so the Analysis page reflects
real backend work rather than a simulated timer.

Guarantees:

* the browser, its context and its page are always closed — success, failure,
  cancellation or timeout (NFR-REL-001, §24);
* every navigation target is re-checked against the SSRF guard, including the
  URL a redirect actually landed on (§23);
* credentials are used once to submit a login form and are never logged,
  echoed, persisted or sent to the model (§16, SEC-007);
* the temporary scan attribute is removed from every frame before the scan
  finishes, so the page is left as it was found;
* the deterministic pipeline decides everything by default; the model is only
  consulted for elements that could not be resolved, and its suggestions are
  validated on the live page like any other candidate (§17).
"""

from __future__ import annotations

import base64
import re
import time
from typing import Any, Callable

from playwright.sync_api import Browser, BrowserContext, Page
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

from app.core.logging import get_logger
from engine.uiscanner import dom_collector, frames as frame_scanner
from engine.uiscanner.accessibility import capture_aria_snapshot, snapshot_section
from engine.uiscanner.crawl import (
    DISCOVER_LINKS_JS,
    normalise_url,
    page_slug,
    select_next_pages,
)
from engine.uiscanner.llm_fallback import suggest_locator
from engine.uiscanner.locator_generator import generate_candidates
from engine.uiscanner.locator_scoring import rank_candidates, recommend, score_candidate
from engine.uiscanner.locator_validator import build_locator, validate_candidate
from engine.uiscanner.redaction import redact_text
from engine.uiscanner.types import (
    CANDIDATE_SELECTORS,
    MAX_LLM_FALLBACKS,
    MAX_PAGES,
    MAX_SCREENSHOT_BYTES,
    SEMANTIC_STRATEGIES,
    STAGE_PROGRESS,
    UI_SCAN_SCHEMA_VERSION,
    FrameDefinition,
    LocatorCandidate,
    ScanOptions,
    UiScanCancelled,
    UiScanError,
)
from engine.uiscanner.url_guard import BlockedUrlError, assert_url_allowed, is_url_allowed

logger = get_logger(__name__)

#: Emitted to the caller as ``(event_type, payload)``.
Emitter = Callable[[str, dict[str, Any]], None]

#: Bounded wait for the network to settle; the scan continues either way.
_NETWORK_IDLE_TIMEOUT_MS = 5_000

#: Bounded wait for a single-page application to mount its first element.
_RENDER_TIMEOUT_MS = 10_000

#: Bounded wait for the element count to stop changing after it has mounted.
_SETTLE_TIMEOUT_MS = 5_000

#: Bounded wait for a submitted sign-in to take effect.
_AUTH_TIMEOUT_MS = 15_000

#: True once two consecutive polls see the same non-zero element count, which
#: is what "the framework has finished rendering" looks like from outside.
_DOM_SETTLED_JS = """
(selector) => {
  let count = 0;
  try { count = document.querySelectorAll(selector).length; } catch (_) { return true; }
  const previous = window.__qaScanElementCount;
  window.__qaScanElementCount = count;
  return count > 0 && previous === count;
}
"""

#: Accessible names that identify a login submit control.
_SUBMIT_NAME_RE = re.compile(r"log ?in|sign ?in|submit|continue|next", re.IGNORECASE)

#: Pre-scan actions the scanner is allowed to perform (§15).
_ALLOWED_ACTIONS = frozenset(
    {"click", "fill", "selectOption", "waitFor", "waitForUrl", "press"}
)


def _slug(text: str, limit: int = 40) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:limit]


class UiScanner:
    """Runs one scan. Not reusable — construct a fresh instance per scan."""

    def __init__(
        self,
        options: ScanOptions,
        *,
        emit: Emitter,
        is_cancelled: Callable[[], bool],
    ) -> None:
        self.options = options
        self._emit = emit
        self._is_cancelled = is_cancelled
        self.stage = "QUEUED"
        self.warnings: list[str] = []
        self.errors: list[str] = []
        self._started = time.monotonic()
        self._deadline = self._started + options.timeout_ms / 1000
        self._blocked_navigations: list[str] = []
        self._llm_calls = 0
        self._llm_accepted = 0
        self._llm_duration_ms = 0
        self._validation_ms = 0.0
        self._pages_scanned = 1

    @property
    def _llm_enabled(self) -> bool:
        return bool(self.options.use_llm_fallback and self.options.model)

    # --- eventing ---------------------------------------------------------

    def log(
        self,
        level: str,
        message: str,
        meta: dict[str, Any] | None = None,
    ) -> None:
        """Emit one live log line (redacted, never carrying credentials)."""
        self._emit(
            "ui_scan.log",
            {
                "level": level,
                "stage": self.stage,
                "message": redact_text(message),
                "meta": meta or {},
            },
        )

    def set_stage(self, stage: str, message: str) -> None:
        self.stage = stage
        self._emit(
            "ui_scan.status",
            {
                "stage": stage,
                "progress": STAGE_PROGRESS.get(stage, 0),
                "message": redact_text(message),
            },
        )
        self.log("info", message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        self.log("warning", message)

    def checkpoint(self) -> None:
        """Stop cooperatively on cancellation, and enforce the scan deadline."""
        if self._is_cancelled():
            raise UiScanCancelled()
        if time.monotonic() > self._deadline:
            raise UiScanError(
                "UI_SCAN_TIMEOUT",
                f"The scan exceeded its {self.options.timeout_ms // 1000}s time limit.",
                stage=self.stage,
            )

    # --- browser lifecycle ------------------------------------------------

    def run(self) -> dict[str, Any]:
        """Execute the scan and return the wire result. Always cleans up."""
        started_at = time.time()
        browser: Browser | None = None
        context: BrowserContext | None = None
        page: Page | None = None
        result: dict[str, Any]

        with sync_playwright() as playwright:
            try:
                self.set_stage(
                    "STARTING_BROWSER",
                    f"Launching {self.options.browser} in "
                    f"{'headless' if self.options.headless else 'headed'} mode",
                )
                engine = getattr(playwright, self.options.browser, None)
                if engine is None:
                    raise UiScanError(
                        "UI_SCAN_BROWSER_UNSUPPORTED",
                        f"Browser '{self.options.browser}' is not supported.",
                        stage=self.stage,
                        recoverable=False,
                    )
                try:
                    browser = engine.launch(headless=self.options.headless)
                except PlaywrightError as exc:
                    raise UiScanError(
                        "UI_SCAN_BROWSER_LAUNCH_FAILED",
                        f"The browser could not be launched: {exc}",
                        stage=self.stage,
                    ) from None

                # A fresh isolated context per scan: no cookie, cache or
                # storage bleed between users or projects (§24).
                context = browser.new_context(
                    storage_state=self.options.storage_state or None,
                    ignore_https_errors=False,
                )
                context.set_default_timeout(min(self.options.timeout_ms, 30_000))
                page = context.new_page()
                page.on("framenavigated", self._on_frame_navigated)
                page.on("crash", lambda _: self.errors.append("The page crashed"))

                result = self._scan(page)
                result["status"] = "COMPLETED"
                self.set_stage("COMPLETED", "UI scan completed successfully")
            except UiScanCancelled:
                self.stage = "CANCELLED"
                result = self._empty_result()
                result["status"] = "CANCELLED"
                self._emit(
                    "ui_scan.status",
                    {"stage": "CANCELLED", "progress": 100, "message": "Scan cancelled"},
                )
                self.log("warning", "UI scan cancelled by user request")
            except UiScanError as exc:
                result = self._empty_result()
                result["status"] = "FAILED"
                result["error"] = exc.to_dict()
                self.stage = "FAILED"
                self._emit(
                    "ui_scan.status",
                    {"stage": "FAILED", "progress": 100, "message": exc.message},
                )
                self.log("error", exc.message, {"code": exc.code})
            except PlaywrightError as exc:
                message = f"The browser reported an error: {exc}"
                result = self._empty_result()
                result["status"] = "FAILED"
                result["error"] = UiScanError(
                    "UI_SCAN_BROWSER_ERROR", message, stage=self.stage
                ).to_dict()
                self.stage = "FAILED"
                self._emit(
                    "ui_scan.status",
                    {"stage": "FAILED", "progress": 100, "message": message},
                )
                self.log("error", message)
            finally:
                self._cleanup(page, context, browser)

        result["startedAt"] = started_at
        result["completedAt"] = time.time()
        result["durationMs"] = int((time.monotonic() - self._started) * 1000)
        result["warnings"] = self.warnings
        result["schemaVersion"] = UI_SCAN_SCHEMA_VERSION
        result.setdefault("selectedModel", self.options.model)
        return result

    def _cleanup(
        self, page: Page | None, context: BrowserContext | None, browser: Browser | None
    ) -> None:
        """Close everything; a cleanup failure is reported, never raised (§24)."""
        for label, closer in (
            ("page", page),
            ("context", context),
            ("browser", browser),
        ):
            if closer is None:
                continue
            try:
                closer.close()
            except PlaywrightError as exc:
                logger.warning("ui-scan %s cleanup failed: %s", label, exc)
                self.warnings.append(f"Browser {label} cleanup reported: {exc}")

    def _on_frame_navigated(self, frame: Any) -> None:
        """Record a main-frame navigation that lands on a blocked address."""
        try:
            if frame.parent_frame is not None:
                return
            url = frame.url or ""
        except PlaywrightError:
            return
        if not url or url == "about:blank":
            return
        if not is_url_allowed(
            url, self.options.allowed_hosts, self.options.allow_private_network
        ):
            self._blocked_navigations.append(url)

    def _assert_no_blocked_navigation(self) -> None:
        if self._blocked_navigations:
            blocked = self._blocked_navigations[-1]
            raise UiScanError(
                "UI_SCAN_URL_BLOCKED",
                f"The page redirected to a blocked address ({blocked}); "
                "the scan was stopped.",
                stage=self.stage,
                recoverable=False,
            )

    # --- scan phases ------------------------------------------------------

    def _scan(self, page: Page) -> dict[str, Any]:
        self.checkpoint()
        self._navigate(page)
        self._run_pre_scan_actions(page)
        self._wait_for_stability(page)

        entry_url = page.url
        elements, frame_defs, snapshot = self._collect_pages(page)
        self.checkpoint()

        # Artefacts describe the page the user asked for. A crawl ends on
        # whatever it visited last, so return to the entry page first rather
        # than shipping a screenshot of an arbitrary page.
        if self._pages_scanned > 1 and normalise_url(page.url) != normalise_url(entry_url):
            self.log("debug", "Returning to the entry page to capture artefacts")
            try:
                page.goto(entry_url, wait_until="domcontentloaded", timeout=self.options.timeout_ms)
                self._wait_for_render(page)
            except PlaywrightError as exc:
                self.warn(f"Could not return to the entry page for artefacts: {exc}")

        # After the DOM pass and before locator generation, matching the stage
        # order the backend state machine and the UI both expect — the snapshot
        # is also what the LLM fallback quotes from when it is consulted.
        if self._pages_scanned > 1 or self.options.max_pages > 1 or self._has_credentials:
            # Locators were generated and validated per page inside the crawl,
            # while each page was open; these stages report the totals.
            if self.options.capture_accessibility:
                self.set_stage(
                    "CAPTURING_ACCESSIBILITY",
                    "Capturing the accessibility snapshot of the entry page",
                )
                if not snapshot:
                    snapshot, snapshot_warnings = capture_aria_snapshot(page)
                    for warning in snapshot_warnings:
                        self.warn(warning)
                if snapshot:
                    self.log("success", "Accessibility snapshot captured")
            self.set_stage(
                "GENERATING_LOCATORS",
                f"Generated locator candidates for {len(elements)} element(s)",
            )
            unique = sum(1 for e in elements if e.get("status") == "unique")
            self.set_stage(
                "VALIDATING_LOCATORS",
                f"{unique} of {len(elements)} element(s) have unique locators "
                f"across {self._pages_scanned} page(s)",
            )
        self.checkpoint()

        screenshot_b64 = self._capture_screenshot(page)

        self.set_stage("SAVING_RESULTS", "Persisting scan results")
        metrics = self._metrics(elements)
        return {
            "url": self.options.url,
            "finalUrl": page.url,
            "pageTitle": page.title() if not page.is_closed() else "",
            "browser": self.options.browser,
            "headless": self.options.headless,
            "elements": elements,
            "frames": frame_defs,
            "metrics": metrics,
            "accessibilitySnapshot": snapshot,
            "screenshotBase64": screenshot_b64,
            "selectedModel": self.options.model,
            "errors": self.errors,
        }

    def _empty_result(self) -> dict[str, Any]:
        return {
            "url": self.options.url,
            "finalUrl": "",
            "pageTitle": "",
            "browser": self.options.browser,
            "headless": self.options.headless,
            "elements": [],
            "frames": [],
            "metrics": self._metrics([]),
            "accessibilitySnapshot": "",
            "screenshotBase64": "",
            "selectedModel": self.options.model,
            "errors": self.errors,
        }

    def _navigate(self, page: Page) -> None:
        target = self.options.url
        self.set_stage("NAVIGATING", f"Navigating to {target}")
        try:
            assert_url_allowed(
                target, self.options.allowed_hosts, self.options.allow_private_network
            )
        except BlockedUrlError as exc:
            raise UiScanError(
                "UI_SCAN_URL_BLOCKED", exc.reason, stage=self.stage, recoverable=False
            ) from None
        try:
            page.goto(target, wait_until="domcontentloaded", timeout=self.options.timeout_ms)
        except PlaywrightTimeout:
            raise UiScanError(
                "UI_SCAN_NAVIGATION_TIMEOUT",
                "The page did not load within the configured timeout.",
                stage=self.stage,
            ) from None
        except PlaywrightError as exc:
            raise UiScanError(
                "UI_SCAN_NAVIGATION_FAILED",
                f"The page could not be opened: {exc}",
                stage=self.stage,
            ) from None
        self._assert_no_blocked_navigation()
        self.log("info", "DOM content loaded")

    @property
    def _has_credentials(self) -> bool:
        return bool(self.options.username and self.options.password)

    def _authenticate(self, page: Page) -> None:
        """Sign in with the supplied credentials, if any (§16).

        Called *after* the target page has been scanned, so a scan aimed at a
        login page captures that page's own controls before signing in — those
        are the locators a login test case is made of.

        Credentials arrive per scan, are used exactly once here and are never
        written to a log line, an event payload, the database or a prompt.
        """
        if self.options.storage_state and not self.options.username:
            self.set_stage("AUTHENTICATING", "Reusing the approved authentication state")
            return
        if not self._has_credentials:
            return

        self.set_stage("AUTHENTICATING", "Signing in to the target application")
        self.checkpoint()

        # The target page usually *is* the sign-in page. Only when it has no
        # form of its own is a separate login URL needed.
        if self.options.login_url and not self._login_form_present(page):
            self.log("info", f"Opening the login page {self.options.login_url}")
            try:
                assert_url_allowed(
                    self.options.login_url,
                    self.options.allowed_hosts,
                    self.options.allow_private_network,
                )
                page.goto(
                    self.options.login_url,
                    wait_until="domcontentloaded",
                    timeout=self.options.timeout_ms,
                )
                self._settle(page)
            except BlockedUrlError as exc:
                raise UiScanError(
                    "UI_SCAN_URL_BLOCKED", exc.reason, stage=self.stage, recoverable=False
                ) from None
            except PlaywrightError as exc:
                raise UiScanError(
                    "UI_SCAN_AUTH_FAILED",
                    f"The login page could not be opened: {exc}",
                    stage=self.stage,
                ) from None

        try:
            # A single-page application mounts its login form after the
            # document has loaded, so the form has to be waited for rather
            # than looked for once. Without this the scanner reports "no login
            # form" on every SPA it is pointed at.
            password_field = page.locator('input[type="password"]').first
            try:
                password_field.wait_for(state="visible", timeout=_RENDER_TIMEOUT_MS)
            except PlaywrightTimeout:
                raise UiScanError(
                    "UI_SCAN_AUTH_NO_FORM",
                    "No login form appeared within "
                    f"{_RENDER_TIMEOUT_MS // 1000}s. Check that the login URL "
                    "points at the sign-in page, or leave the credentials blank "
                    "to scan the page anonymously.",
                    stage=self.stage,
                ) from None
            user_field = self._find_username_field(page)
            if user_field is None:
                raise UiScanError(
                    "UI_SCAN_AUTH_NO_FORM",
                    "The login form has no username or email field the scanner could use.",
                    stage=self.stage,
                )

            user_field.fill(self.options.username)
            password_field.fill(self.options.password)
            self.log("info", "Login form completed for the supplied account")

            submit = self._find_submit_control(page)
            if submit is None:
                password_field.press("Enter")
            else:
                submit.click()

            # Sign-in has taken effect once the password field is gone. A
            # single-page application performs no navigation to wait on, so the
            # DOM condition is the only reliable signal; a timeout here is not
            # fatal, because the check below reports what the application is
            # actually showing.
            try:
                password_field.wait_for(state="hidden", timeout=_AUTH_TIMEOUT_MS)
            except PlaywrightTimeout:
                pass
            page.wait_for_load_state("domcontentloaded", timeout=self.options.timeout_ms)
            self._settle(page)
        except PlaywrightTimeout:
            raise UiScanError(
                "UI_SCAN_AUTH_TIMEOUT",
                "The application did not respond to the sign-in attempt in time.",
                stage=self.stage,
            ) from None
        except PlaywrightError as exc:
            raise UiScanError(
                "UI_SCAN_AUTH_FAILED",
                f"The sign-in attempt failed: {exc}",
                stage=self.stage,
            ) from None

        self._assert_no_blocked_navigation()
        if self._login_form_still_showing(page):
            # Quote the application's own message when it gives one ("Invalid
            # credentials"); "sign-in failed" alone leaves the user guessing
            # whether it was the password, the URL or the scanner.
            reason = self._login_error_message(page)
            raise UiScanError(
                "UI_SCAN_AUTH_FAILED",
                "Sign-in did not succeed: the application is still showing the "
                "login form."
                + (f' It reported: "{reason}".' if reason else "")
                + " Check the credentials and the login URL.",
                stage=self.stage,
            )
        self.log("success", "Authenticated with the target application")

    def _login_form_present(self, page: Page) -> bool:
        """True when this page offers a sign-in form right now."""
        try:
            return page.locator('input[type="password"]').first.is_visible()
        except PlaywrightError:
            return False

    def _login_form_still_showing(self, page: Page) -> bool:
        """True when a password field is still visible after signing in.

        Visibility rather than presence: plenty of applications keep the login
        form in the DOM and simply hide it after a successful sign-in.
        """
        try:
            return page.locator('input[type="password"]').first.is_visible()
        except PlaywrightError:
            # Detached with the old page — that is a successful sign-in.
            return False

    def _login_error_message(self, page: Page) -> str:
        """The application's own sign-in error, when it shows one."""
        for selector in ('[role="alert"]', '[aria-live="assertive"]', ".oxd-alert-content"):
            try:
                alert = page.locator(selector).first
                if alert.count() and alert.is_visible():
                    text = redact_text((alert.inner_text() or "").strip())
                    if text:
                        return " ".join(text.split())[:160]
            except PlaywrightError:
                continue
        return ""

    def _find_username_field(self, page: Page):
        """First plausible identifier field, preferring explicit semantics."""
        for selector in (
            'input[type="email"]',
            'input[autocomplete="username"]',
            'input[name*="user" i]',
            'input[name*="email" i]',
            'input[id*="user" i]',
            'input[id*="email" i]',
            'input[type="text"]',
            'input:not([type]), input[type="tel"]',
        ):
            locator = page.locator(selector).first
            try:
                if locator.count() > 0 and locator.is_visible():
                    return locator
            except PlaywrightError:
                continue
        return None

    def _find_submit_control(self, page: Page):
        for selector in ('button[type="submit"]', 'input[type="submit"]'):
            locator = page.locator(selector).first
            try:
                if locator.count() > 0 and locator.is_visible():
                    return locator
            except PlaywrightError:
                continue
        try:
            by_name = page.get_by_role("button", name=_SUBMIT_NAME_RE).first
            if by_name.count() > 0:
                return by_name
        except PlaywrightError:
            pass
        button = page.locator("button").first
        try:
            return button if button.count() > 0 else None
        except PlaywrightError:
            return None

    def _run_pre_scan_actions(self, page: Page) -> None:
        """Reveal dynamic UI (menus, dialogs, tabs) before scanning (§15)."""
        actions = self.options.pre_scan_actions or []
        if not actions:
            return
        self.log("info", f"Running {len(actions)} pre-scan action(s)")
        for index, action in enumerate(actions, start=1):
            self.checkpoint()
            kind = str(action.get("action", "")).strip()
            if kind not in _ALLOWED_ACTIONS:
                self.warn(f"Pre-scan action {index} ignored: '{kind}' is not supported")
                continue
            try:
                self._run_action(page, kind, action)
                self.log("info", f"Pre-scan action {index}: {kind} completed")
            except (PlaywrightError, ValueError) as exc:
                self.warn(f"Pre-scan action {index} ({kind}) failed: {exc}")
        self._assert_no_blocked_navigation()

    def _run_action(self, page: Page, kind: str, action: dict[str, Any]) -> None:
        if kind == "waitForUrl":
            page.wait_for_url(str(action.get("url", "")), timeout=10_000)
            return
        descriptor = action.get("locator")
        if not isinstance(descriptor, dict):
            raise ValueError("the action has no machine-readable locator")
        locator = build_locator(page, descriptor)
        if kind == "click":
            locator.click(timeout=10_000)
        elif kind == "fill":
            locator.fill(str(action.get("value", "")), timeout=10_000)
        elif kind == "selectOption":
            locator.select_option(str(action.get("value", "")), timeout=10_000)
        elif kind == "press":
            locator.press(str(action.get("key", "Enter")), timeout=10_000)
        elif kind == "waitFor":
            locator.first.wait_for(state="visible", timeout=10_000)

    def _settle(self, page: Page) -> None:
        """Bounded wait for the network to go quiet; never a blind sleep."""
        try:
            page.wait_for_load_state("networkidle", timeout=_NETWORK_IDLE_TIMEOUT_MS)
        except PlaywrightTimeout:
            self.log("debug", "Network did not fully settle; continuing with the scan")
        except PlaywrightError as exc:
            self.log("debug", f"Load-state wait skipped: {exc}")

    def _wait_for_stability(self, page: Page) -> None:
        self.set_stage("WAITING_FOR_PAGE", "Waiting for the page to stabilise")
        self._settle(page)
        self._wait_for_render(page)
        self._assert_no_blocked_navigation()

    def _wait_for_render(self, page: Page) -> None:
        """Wait until the application has actually rendered something scannable.

        `networkidle` is not enough for a single-page application: the bundle
        finishes downloading, the network goes quiet, and only *then* does the
        framework mount the DOM. Scanning at that moment finds an empty page —
        and reports a perfectly successful scan of nothing, which is worse than
        failing.

        So the wait is on the real condition rather than the clock: first that
        at least one test-relevant element exists, then that the number of them
        has stopped changing between two consecutive polls. Both are bounded;
        neither is an arbitrary sleep, and a page that legitimately has no
        elements still completes with a warning rather than hanging.
        """
        selector = ", ".join(CANDIDATE_SELECTORS)
        try:
            page.locator(selector).first.wait_for(
                state="attached", timeout=_RENDER_TIMEOUT_MS
            )
        except PlaywrightTimeout:
            self.warn(
                f"No test-relevant element had rendered after "
                f"{_RENDER_TIMEOUT_MS // 1000}s. The application may render "
                "only after a sign-in or an interaction — add pre-scan actions "
                "or scan the page that follows sign-in."
            )
            return
        except PlaywrightError as exc:
            self.log("debug", f"Render wait skipped: {exc}")
            return

        settled = self._wait_for_stable_count(page, selector)
        # A data-heavy page paints its shell first and fetches its rows after,
        # so a count can be "stable" simply because the request has not landed
        # yet. One more network-quiet wait, then re-check: without this, the
        # same table scans as 36 elements or 216 depending on the network.
        if settled:
            try:
                page.wait_for_load_state("networkidle", timeout=_NETWORK_IDLE_TIMEOUT_MS)
                self._wait_for_stable_count(page, selector)
            except PlaywrightTimeout:
                self.log("debug", "Network still busy after render; scanning anyway")
            except PlaywrightError as exc:
                self.log("debug", f"Post-render settle skipped: {exc}")

    def _wait_for_stable_count(self, page: Page, selector: str) -> bool:
        """Wait until two consecutive polls see the same element count."""
        try:
            page.wait_for_function(
                _DOM_SETTLED_JS, arg=selector, timeout=_SETTLE_TIMEOUT_MS
            )
            self.log("debug", "DOM element count has stabilised")
            return True
        except PlaywrightTimeout:
            self.log(
                "debug",
                "The page is still adding elements; scanning the current state",
            )
        except PlaywrightError as exc:
            self.log("debug", f"Stability check skipped: {exc}")
        return False

    def _collect_pages(
        self, page: Page
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
        """Scan the target page and, when asked, the pages it links to (§15).

        Each page is scanned *and its locators validated* before moving on,
        because a locator can only be proved against the page it came from —
        validating page five's candidates against page one would reject every
        one of them.

        Returns the aggregated elements, the frames of every page, and the
        entry page's accessibility snapshot.
        """
        max_pages = max(1, min(self.options.max_pages, MAX_PAGES))
        # Signing in reveals a page the user never had to ask for, so the page
        # it lands on is scanned in addition to the requested budget rather
        # than consuming it — otherwise a default scan of a login page would
        # return the login form and nothing else.
        budget = max_pages + (1 if self._has_credentials or self.options.storage_state else 0)
        single_page = budget == 1
        self.set_stage("SCANNING_DOM", "Scanning the document for test-relevant elements")

        entry_url = page.url
        queue: list[dict[str, Any]] = [{"url": entry_url, "text": "entry page"}]
        visited: set[str] = set()
        queued: set[str] = {normalise_url(entry_url)}
        all_elements: list[dict[str, Any]] = []
        all_frames: list[dict[str, Any]] = []
        entry_snapshot = ""
        remaining_elements = self.options.max_elements
        pages_done = 0

        while queue and pages_done < budget and remaining_elements > 0:
            self.checkpoint()
            target = queue.pop(0)
            index = pages_done

            # The post-sign-in page is already open; everything else is a
            # link the crawl chose to follow.
            if index > 0 and not target.get("inPlace"):
                if not self._open_crawled_page(page, target):
                    continue
            visited.add(normalise_url(page.url))
            pages_done += 1
            slug = page_slug(page.url)

            if budget > 1:
                self._emit(
                    "ui_scan.status",
                    {
                        "stage": self.stage,
                        # Pages occupy the span between DOM scanning and
                        # locator validation, so the bar advances per page.
                        "progress": STAGE_PROGRESS["SCANNING_DOM"]
                        + int(35 * pages_done / budget),
                        "message": f"Scanning page {pages_done} of up to {budget}",
                    },
                )
                self.log("info", f"Scanning page {pages_done}: {page.url}")

            elements, frame_defs = self._collect_elements(page, slug)
            for frame in frame_defs:
                frame["pageUrl"] = page.url
                frame["pageSlug"] = slug
            all_frames.extend(frame_defs)
            remaining_elements -= len(elements)

            snapshot = ""
            if elements and (self.options.capture_accessibility or self._llm_enabled):
                # A single-page scan announces the capture in its natural slot,
                # before locator generation. A crawl cannot: the stage sequence
                # only moves forwards, so it is announced once at the end.
                if single_page and self.options.capture_accessibility:
                    self.set_stage(
                        "CAPTURING_ACCESSIBILITY", "Capturing the accessibility snapshot"
                    )
                snapshot, snapshot_warnings = capture_aria_snapshot(page)
                if index == 0:
                    for warning in snapshot_warnings:
                        self.warn(warning)
                    if single_page and self.options.capture_accessibility and snapshot:
                        self.log("success", "Accessibility snapshot captured")
            if index == 0:
                entry_snapshot = snapshot

            if elements:
                # Generate, validate and score against this page, then remove
                # the scan attribute before navigating away.
                all_elements.extend(
                    self._resolve_locators(page, elements, snapshot, emit_stages=single_page)
                )
            cleanup_scan_attributes(page)

            # Sign in only once the requested page has been scanned, so its
            # own controls are part of the result.
            if index == 0 and (self._has_credentials or self.options.storage_state):
                self._authenticate(page)
                landing = page.url
                # Queued unconditionally: plenty of applications sign in
                # without changing the address, and the signed-in view is a
                # different page in every sense that matters to a scanner.
                queued.add(normalise_url(landing))
                queue.insert(
                    0, {"url": landing, "text": "after sign-in", "inPlace": True}
                )
                if normalise_url(landing) in visited:
                    self.log(
                        "debug",
                        "Signing in did not change the address; the signed-in "
                        "view is scanned as a second page at the same URL",
                    )

            if pages_done < budget:
                self._enqueue_links(page, queue, pages_done, queued, budget)

        self._pages_scanned = pages_done
        if budget > 1:
            self.log(
                "info",
                f"Scanned {self._pages_scanned} page(s); found {len(all_elements)} "
                "element(s) in total",
            )
            if remaining_elements <= 0:
                self.warn(
                    f"Element limit ({self.options.max_elements}) reached; "
                    "remaining pages were not scanned."
                )
        return all_elements, all_frames, entry_snapshot

    def _open_crawled_page(self, page: Page, target: dict[str, Any]) -> bool:
        """Navigate to a discovered page; a failure skips it, never the scan."""
        url = str(target.get("url", ""))
        try:
            assert_url_allowed(
                url, self.options.allowed_hosts, self.options.allow_private_network
            )
        except BlockedUrlError as exc:
            self.warn(f"Skipped {url}: {exc.reason}")
            return False
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=self.options.timeout_ms)
            self._settle(page)
            self._wait_for_render(page)
        except PlaywrightTimeout:
            self.warn(f"Skipped {url}: it did not load within the timeout")
            return False
        except PlaywrightError as exc:
            self.warn(f"Skipped {url}: {exc}")
            return False
        self._assert_no_blocked_navigation()
        return True

    def _enqueue_links(
        self,
        page: Page,
        queue: list[dict[str, Any]],
        pages_done: int,
        queued: set[str],
        budget: int,
    ) -> None:
        """Add this page's in-app links to the crawl queue, safely (§15)."""
        try:
            links = page.evaluate(DISCOVER_LINKS_JS)
        except PlaywrightError as exc:
            self.log("debug", f"Link discovery skipped: {exc}")
            return
        accepted, skipped = select_next_pages(links, set(), queued)
        room = budget - pages_done - len(queue)
        if room > 0:
            queue.extend(accepted[:room])
        for reason, count in skipped.items():
            self.log("debug", f"Skipped {count} link(s) that {reason}")

    def _collect_elements(
        self, page: Page, page_slug_value: str = ""
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Discover elements across the main document and every reachable frame."""
        discovered, frame_warnings = (
            frame_scanner.discover_frames(page)
            if self.options.scan_frames
            else ([(page.main_frame, FrameDefinition(title="main document"))], [])
        )
        for warning in frame_warnings:
            self.warn(warning)
        if len(discovered) > 1:
            self.set_stage(
                "SCANNING_FRAMES",
                f"Scanning {len(discovered)} frame(s) including the main document",
            )

        elements: list[dict[str, Any]] = []
        frame_defs: list[dict[str, Any]] = []
        remaining = self.options.max_elements
        key_counts: dict[str, int] = {}
        try:
            page_title = page.title()
        except PlaywrightError:
            page_title = ""

        for position, (frame, definition) in enumerate(discovered):
            self.checkpoint()
            frame_defs.append({**definition.to_dict(), "elementCount": 0})
            if remaining <= 0:
                self.warn(
                    f"Element limit ({self.options.max_elements}) reached; "
                    f"frame {position + 1} was not scanned."
                )
                continue
            if len(discovered) > 1:
                self.log(
                    "info",
                    f"Scanning frame {position + 1} of {len(discovered)}"
                    + (f" ({definition.title or definition.url})" if position else ""),
                )
            try:
                collected = dom_collector.collect_frame(
                    frame,
                    uid_prefix=f"f{position}",
                    max_elements=remaining,
                    include_hidden=self.options.include_hidden,
                )
            except PlaywrightError as exc:
                self.warn(f"Frame {position + 1} could not be scanned: {exc}")
                continue

            frame_elements = collected.get("elements", [])
            remaining -= len(frame_elements)
            frame_defs[-1]["elementCount"] = len(frame_elements)
            for element in frame_elements:
                element["frame"] = definition.to_dict()
                element["pageUrl"] = page.url
                element["pageTitle"] = page_title
                element["pageSlug"] = page_slug_value
                element["elementKey"] = self._element_key(element, position, key_counts)
                elements.append(element)
            if collected.get("skippedHidden"):
                self.log(
                    "debug",
                    f"Frame {position + 1}: skipped {collected['skippedHidden']} hidden element(s)",
                )
            if collected.get("skippedDecorative"):
                self.log(
                    "debug",
                    f"Frame {position + 1}: skipped "
                    f"{collected['skippedDecorative']} element(s) marked decorative "
                    "with role=presentation/none",
                )

        self.log("info", f"Found {len(elements)} candidate UI elements")
        if not elements:
            self.warn(
                "No test-relevant elements were found. The page may still be "
                "loading, or everything on it may be hidden."
            )
        return elements, frame_defs

    def _element_key(
        self, element: dict[str, Any], frame_index: int, counts: dict[str, int]
    ) -> str:
        """Stable, human-readable key reused across rescans of the same page."""
        test_ids = element.get("testIds") or {}
        identity = (
            next(iter(test_ids.values()), "")
            or element.get("accessibleName")
            or element.get("context", {}).get("associatedLabel")
            or element.get("placeholder")
            or element.get("name")
            or element.get("id")
            or element.get("visibleText", "")[:40]
        )
        base = (
            f"f{frame_index}:{element.get('tagName', 'el')}:"
            f"{element.get('inferredRole') or 'none'}:{_slug(identity) or 'unnamed'}"
        )
        counts[base] = counts.get(base, 0) + 1
        return base if counts[base] == 1 else f"{base}#{counts[base]}"

    # --- locator pipeline -------------------------------------------------

    def _resolve_locators(
        self,
        page: Page,
        elements: list[dict[str, Any]],
        snapshot: str,
        emit_stages: bool = True,
    ) -> list[dict[str, Any]]:
        """Generate, validate and score locators for one page's elements.

        `emit_stages` is off during a crawl: the stage vocabulary only ever
        moves forwards, so a per-page GENERATING/VALIDATING pair would be
        dropped by the backend the moment the next page went back to scanning.
        The totals are reported once the crawl finishes instead.
        """
        if emit_stages:
            self.set_stage("GENERATING_LOCATORS", "Generating locator candidates")
        for element in elements:
            frame_data = element.get("frame") or {}
            definition = FrameDefinition(
                path=list(frame_data.get("path") or []),
                url=frame_data.get("url", ""),
                name=frame_data.get("name", ""),
                title=frame_data.get("title", ""),
                selector=frame_data.get("selector", ""),
                parent_index=int(frame_data.get("parentIndex", -1)),
                index=int(frame_data.get("index", 0)),
            )
            element["_candidates"] = generate_candidates(
                element, element["elementKey"], definition
            )
        total_candidates = sum(len(e["_candidates"]) for e in elements)
        self.log(
            "info",
            f"Generated {total_candidates} locator candidate(s) for {len(elements)} element(s)",
        )

        if emit_stages:
            self.set_stage(
                "VALIDATING_LOCATORS", "Validating locators against the live page"
            )
        unresolved: list[dict[str, Any]] = []
        validation_started = time.monotonic()

        for index, element in enumerate(elements, start=1):
            if index % 10 == 0:
                self.checkpoint()
                if emit_stages:
                    self._emit(
                        "ui_scan.status",
                        {
                            "stage": "VALIDATING_LOCATORS",
                            "progress": STAGE_PROGRESS["VALIDATING_LOCATORS"]
                            + int(20 * index / max(1, len(elements))),
                            "message": f"Validated {index} of {len(elements)} elements",
                        },
                    )
            candidates: list[LocatorCandidate] = element.pop("_candidates")
            label = self._element_label(element)
            for candidate in candidates:
                validate_candidate(page, candidate, element)
                score_candidate(candidate, element)
            candidates = rank_candidates(candidates)
            best, status = recommend(candidates)

            if best is None or not best.unique:
                unresolved.append(element)
            if best is not None and not best.unique:
                self.log(
                    "warning",
                    f"{label}: best locator matched {best.match_count} elements",
                )

            element["candidates"] = candidates
            element["recommendedLocatorId"] = best.id if best else ""
            element["status"] = status

        self._validation_ms = (time.monotonic() - validation_started) * 1000
        resolved = sum(1 for e in elements if e["status"] == "unique")
        self.log(
            "info",
            f"{resolved} of {len(elements)} elements have unique locators",
        )

        if unresolved and self.options.use_llm_fallback and self.options.model:
            self._llm_pass(page, elements, unresolved, snapshot)

        for element in elements:
            element["candidates"] = [c.to_dict() for c in element["candidates"]]
        return elements

    def _element_label(self, element: dict[str, Any]) -> str:
        name = (
            element.get("accessibleName")
            or element.get("context", {}).get("associatedLabel")
            or element.get("placeholder")
            or element.get("visibleText", "")[:40]
            or element.get("tagName", "element")
        )
        return f"{element.get('inferredRole') or element.get('tagName', 'element')} '{name}'"

    def _llm_pass(
        self,
        page: Page,
        elements: list[dict[str, Any]],
        unresolved: list[dict[str, Any]],
        snapshot: str,
    ) -> None:
        """Ask the project's model about the elements still without a locator."""
        budget = min(len(unresolved), MAX_LLM_FALLBACKS)
        self.log(
            "info",
            f"Asking the project model ({self.options.model}) about "
            f"{budget} unresolved element(s)",
        )
        if len(unresolved) > budget:
            self.warn(
                f"{len(unresolved) - budget} unresolved element(s) were not sent to "
                f"the model: the per-scan fallback budget is {MAX_LLM_FALLBACKS}."
            )

        for element in unresolved[:budget]:
            self.checkpoint()
            label = self._element_label(element)
            similar = [
                {
                    "role": other.get("inferredRole", ""),
                    "name": other.get("accessibleName", ""),
                    "parentContext": [
                        s.get("name", "")
                        for s in (other.get("context", {}).get("scopes") or [])[:2]
                    ],
                }
                for other in elements
                if other is not element
                and other.get("inferredRole") == element.get("inferredRole")
                and other.get("accessibleName") == element.get("accessibleName")
            ]
            frame_data = element.get("frame") or {}
            definition = FrameDefinition(
                path=list(frame_data.get("path") or []),
                index=int(frame_data.get("index", 0)),
            )
            candidate, metrics = suggest_locator(
                element=element,
                element_key=element["elementKey"],
                tried=element["candidates"],
                similar=similar,
                aria_excerpt=snapshot_section(snapshot, element.get("accessibleName", "")),
                intent=f"Interact with {label}",
                model=self.options.model,
                temperature=self.options.temperature,
                frame=definition,
            )
            self._llm_calls += 1
            self._llm_duration_ms += int(metrics.get("durationMs", 0))
            if candidate is None:
                self.log(
                    "debug",
                    f"{label}: the model returned no usable locator"
                    + (f" ({metrics['error']})" if metrics.get("error") else ""),
                )
                continue

            # A model suggestion is a candidate like any other: it only counts
            # once the live page confirms it (§17).
            validate_candidate(page, candidate, element)
            score_candidate(candidate, element)
            element["candidates"] = rank_candidates([*element["candidates"], candidate])
            best, status = recommend(element["candidates"])
            element["recommendedLocatorId"] = best.id if best else ""
            element["status"] = status
            if best is candidate and candidate.unique:
                self._llm_accepted += 1
                self.log("success", f"{label}: model-proposed locator validated as unique")
            else:
                self.log(
                    "debug",
                    f"{label}: model-proposed locator rejected by live validation",
                )

    # --- artefacts + metrics ----------------------------------------------

    def _capture_screenshot(self, page: Page) -> str:
        if not self.options.capture_screenshot:
            return ""
        self.set_stage("CAPTURING_SCREENSHOT", "Capturing a full-page screenshot")
        try:
            data = page.screenshot(full_page=True, type="png", timeout=20_000)
        except PlaywrightError as exc:
            self.warn(f"Screenshot capture failed: {exc}")
            return ""
        if len(data) > MAX_SCREENSHOT_BYTES:
            self.warn(
                f"Screenshot discarded: {len(data) // 1024}KB exceeds the "
                f"{MAX_SCREENSHOT_BYTES // 1024}KB limit."
            )
            return ""
        self.log("success", f"Screenshot captured ({len(data) // 1024}KB)")
        return base64.b64encode(data).decode()

    def _metrics(self, elements: list[dict[str, Any]]) -> dict[str, Any]:
        """Research metrics for the dissertation evaluation (§29)."""
        total = len(elements)
        candidates_total = 0
        unique = 0
        semantic = 0
        test_id = 0
        css = 0
        xpath = 0
        for element in elements:
            candidates = element.get("candidates", [])
            candidates_total += len(candidates)
            recommended_id = element.get("recommendedLocatorId", "")
            best = next(
                (
                    c
                    for c in candidates
                    if (c.id if isinstance(c, LocatorCandidate) else c.get("id"))
                    == recommended_id
                ),
                None,
            )
            if best is None:
                continue
            strategy = best.strategy if isinstance(best, LocatorCandidate) else best["strategy"]
            is_unique = best.unique if isinstance(best, LocatorCandidate) else best["unique"]
            if is_unique:
                unique += 1
            if strategy in SEMANTIC_STRATEGIES:
                semantic += 1
            elif strategy == "testId":
                test_id += 1
            elif strategy in {"css", "name"}:
                css += 1
            elif strategy == "xpath":
                xpath += 1

        def rate(part: int) -> float:
            return round(part / total, 4) if total else 0.0

        return {
            "totalElements": total,
            "pagesScanned": self._pages_scanned,
            "uniqueLocators": unique,
            "unresolvedElements": total - unique,
            "uniqueLocatorRate": rate(unique),
            "semanticLocatorRate": rate(semantic),
            "testIdLocatorRate": rate(test_id),
            "cssFallbackRate": rate(css),
            "xpathFallbackRate": rate(xpath),
            "averageCandidatesPerElement": round(candidates_total / total, 2) if total else 0.0,
            "locatorGenerationSuccessRate": rate(
                sum(1 for e in elements if e.get("candidates"))
            ),
            "validationDurationMs": int(self._validation_ms),
            "llmFallbackCount": self._llm_calls,
            "llmFallbackAccepted": self._llm_accepted,
            "llmFallbackRate": rate(self._llm_calls),
            "llmDurationMs": self._llm_duration_ms,
            "warningCount": len(self.warnings),
            "errorCount": len(self.errors),
        }


def run_scan(
    options: ScanOptions,
    *,
    emit: Emitter,
    is_cancelled: Callable[[], bool] = lambda: False,
) -> dict[str, Any]:
    """Run one UI scan end to end and return its wire result."""
    return UiScanner(options, emit=emit, is_cancelled=is_cancelled).run()


def cleanup_scan_attributes(page: Page) -> None:
    """Remove every trace the scan left on the page."""
    for frame in page.frames:
        dom_collector.clear_scan_attributes(frame)
    try:
        page.evaluate("() => { delete window.__qaScanElementCount; }")
    except PlaywrightError:
        # The page navigated away or closed — the property went with it.
        pass
