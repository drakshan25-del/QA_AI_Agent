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
        expect(locator).to_have_count(count)

    def assert_url_contains(self, fragment: str) -> None:
        """Assert the current page URL contains ``fragment``."""
        # to_have_url accepts a regex; escape the fragment so this is a
        # deterministic substring match with auto-waiting.
        expect(self.page).to_have_url(re.compile(".*" + re.escape(fragment) + ".*"))
