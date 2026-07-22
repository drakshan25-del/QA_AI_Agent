"""Base page object for the deterministic automation framework (FR-AUT-001, FR-AUT-003).

All page objects derive from :class:`BasePage`. It enforces the framework
conventions the Automation Agent is prompted with:

* accessibility-first locators via ``get_by_role`` / ``get_by_label`` /
  ``get_by_placeholder`` / ``get_by_test_id`` (FR-AUT-003);
* web-first ``expect()`` assertions, never ``time.sleep`` (FR-AUT-004);
* the target base URL is injected, never hard-coded (FR-AUT-005).
"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, Page, expect

try:
    # Live execution step emission (FR-EXE-006). No-op when the engine has not
    # set QA_EVENT_SINK, so standalone/V1 test runs are unaffected.
    from engine.service.step_events import emit_step
except Exception:  # pragma: no cover - engine package not importable in some runs

    def emit_step(*_args, **_kwargs) -> None:  # type: ignore[misc]
        return None


class BasePage:
    """Minimal, deterministic base class for sync-Playwright page objects.

    Args:
        page: The Playwright page (one fresh browser context per test,
            FR-EXE-002 — provided by pytest-playwright).
        base_url: Root URL of the application under test, injected from the
            ``base_url`` fixture (FR-AUT-005).
    """

    #: Default path of the page, overridden by subclasses (e.g. "/login").
    path: str = "/"

    def __init__(self, page: Page, base_url: str) -> None:
        self.page = page
        self.base_url = base_url.rstrip("/")

    # -- navigation ---------------------------------------------------------

    def goto(self, path: str | None = None) -> None:
        """Navigate to ``base_url + path`` (defaults to the class ``path``)."""
        target = self.path if path is None else path
        if not target.startswith("/"):
            target = "/" + target
        url = f"{self.base_url}{target}"
        emit_step("navigate", target=url, status="running", current_url=url)
        self.page.goto(url)
        emit_step("navigate", target=url, status="passed", current_url=url)

    # -- instrumented user actions (FR-EXE-007, FR-V3-EXE-005) ---------------
    # Page objects must perform interactions through these helpers so the
    # live execution timeline shows every click/fill/select, not only
    # navigations. Each emits a running→passed/failed pair; failures re-raise.

    def click(self, locator: Locator, label: str = "") -> None:
        """Click ``locator``, emitting a live step event around the action."""
        target = label or self._describe(locator)
        emit_step("click", target=target, status="running", current_url=self.page.url)
        try:
            locator.click()
        except Exception:
            emit_step("click", target=target, status="failed", current_url=self.page.url)
            raise
        emit_step("click", target=target, status="passed", current_url=self.page.url)

    def fill(self, locator: Locator, value: str, label: str = "") -> None:
        """Fill ``locator`` with ``value``; the emitted value is redacted for
        sensitive fields by the step-event layer (SEC-007, FR-EXE-008)."""
        target = label or self._describe(locator)
        emit_step("fill", target=target, value=value, status="running", current_url=self.page.url)
        try:
            locator.fill(value)
        except Exception:
            emit_step("fill", target=target, value=value, status="failed", current_url=self.page.url)
            raise
        emit_step("fill", target=target, value=value, status="passed", current_url=self.page.url)

    def select(self, locator: Locator, value: str, label: str = "") -> None:
        """Select ``value`` in the dropdown ``locator`` with live step events."""
        target = label or self._describe(locator)
        emit_step("select", target=target, value=value, status="running", current_url=self.page.url)
        try:
            locator.select_option(value)
        except Exception:
            emit_step("select", target=target, value=value, status="failed", current_url=self.page.url)
            raise
        emit_step("select", target=target, value=value, status="passed", current_url=self.page.url)

    def check(self, locator: Locator, label: str = "") -> None:
        """Check the checkbox/radio ``locator`` with live step events."""
        target = label or self._describe(locator)
        emit_step("click", target=f"check:{target}", status="running", current_url=self.page.url)
        try:
            locator.check()
        except Exception:
            emit_step("click", target=f"check:{target}", status="failed", current_url=self.page.url)
            raise
        emit_step("click", target=f"check:{target}", status="passed", current_url=self.page.url)

    def upload(self, locator: Locator, file_path: str, label: str = "") -> None:
        """Set ``file_path`` on the file input ``locator`` with live events."""
        target = label or self._describe(locator)
        emit_step("upload", target=target, value=file_path, status="running", current_url=self.page.url)
        try:
            locator.set_input_files(file_path)
        except Exception:
            emit_step("upload", target=target, value=file_path, status="failed", current_url=self.page.url)
            raise
        emit_step("upload", target=target, value=file_path, status="passed", current_url=self.page.url)

    @staticmethod
    def _describe(locator: Locator) -> str:
        """Human-readable locator description for step events (plain-language
        labels, NFR-USA-005); never raises."""
        try:
            return str(locator)[:120]
        except Exception:  # pragma: no cover
            return "element"

    # -- accessibility-first locator helpers (FR-AUT-003) --------------------

    def by_role(self, role: str, name: str | None = None) -> Locator:
        """Locate by ARIA role, optionally filtered by accessible name."""
        if name is None:
            return self.page.get_by_role(role)  # type: ignore[arg-type]
        return self.page.get_by_role(role, name=name)  # type: ignore[arg-type]

    def by_label(self, text: str, *, exact: bool = False) -> Locator:
        """Locate a form control by its associated label text."""
        return self.page.get_by_label(text, exact=exact)

    def by_placeholder(self, text: str, *, exact: bool = False) -> Locator:
        """Locate an input by its placeholder text."""
        return self.page.get_by_placeholder(text, exact=exact)

    def by_test_id(self, test_id: str) -> Locator:
        """Locate an element by its ``data-testid`` attribute."""
        return self.page.get_by_test_id(test_id)

    # Playwright-native aliases (``get_by_*``). The framework's documented
    # convention (and the Automation Agent's generated page objects) use the
    # ``get_by_*`` names; these thin aliases make that generated code resolve
    # against the same accessibility-first locators, so a page object may use
    # either spelling interchangeably.
    def get_by_role(self, role: str, name: str | None = None) -> Locator:
        """Alias of :meth:`by_role`."""
        return self.by_role(role, name)

    def get_by_label(self, text: str, *, exact: bool = False) -> Locator:
        """Alias of :meth:`by_label`."""
        return self.by_label(text, exact=exact)

    def get_by_placeholder(self, text: str, *, exact: bool = False) -> Locator:
        """Alias of :meth:`by_placeholder`."""
        return self.by_placeholder(text, exact=exact)

    def get_by_test_id(self, test_id: str) -> Locator:
        """Alias of :meth:`by_test_id`."""
        return self.by_test_id(test_id)

    # -- web-first assertion helpers (FR-AUT-004) ----------------------------

    def assert_visible(self, locator: Locator) -> None:
        """Assert the element becomes visible (auto-waiting, no sleeps)."""
        emit_step("assert", target="visible", status="running")
        expect(locator).to_be_visible()
        emit_step("assert", target="visible", status="passed")

    def assert_contains_text(self, locator: Locator, text: str) -> None:
        """Assert the element's text contains ``text`` (auto-waiting)."""
        emit_step("assert", target=f"contains_text:{text}", status="running")
        expect(locator).to_contain_text(text)
        emit_step("assert", target=f"contains_text:{text}", status="passed")

    def assert_count(self, locator: Locator, count: int) -> None:
        """Assert the locator resolves to exactly ``count`` elements."""
        emit_step("assert", target=f"count:{count}", status="running")
        expect(locator).to_have_count(count)
        emit_step("assert", target=f"count:{count}", status="passed")

    def assert_url_contains(self, fragment: str) -> None:
        """Assert the current page URL contains ``fragment``."""
        emit_step("assert", target=f"url_contains:{fragment}", status="running",
                  current_url=self.page.url)
        # to_have_url accepts a regex; escape the fragment so this is a
        # deterministic substring match with auto-waiting.
        expect(self.page).to_have_url(re.compile(".*" + re.escape(fragment) + ".*"))
        emit_step("assert", target=f"url_contains:{fragment}", status="passed",
                  current_url=self.page.url)

    def assert_url_not_contains(self, fragment: str) -> None:
        """Assert the current page URL does NOT contain ``fragment``."""
        emit_step("assert", target=f"url_not_contains:{fragment}", status="running",
                  current_url=self.page.url)
        expect(self.page).not_to_have_url(re.compile(".*" + re.escape(fragment) + ".*"))
        emit_step("assert", target=f"url_not_contains:{fragment}", status="passed",
                  current_url=self.page.url)
