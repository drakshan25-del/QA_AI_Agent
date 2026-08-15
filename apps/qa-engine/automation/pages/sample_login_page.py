"""Page object for the demo target app's login page (FR-AUT-001, FR-AUT-003).

Contract with the sample app (built by a separate module):
``/login`` serves a form with ``data-testid`` inputs ``username`` and
``password``, a submit button with role ``button`` and accessible name
``Log in``, and a flash message element ``[data-testid=flash]``.
"""

from __future__ import annotations

from playwright.sync_api import Locator, Page, expect

from automation.pages.base_page import BasePage


class SampleLoginPage(BasePage):
    """Login page of the sample application under test."""

    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_input: Locator = self.by_test_id("username")
        self.password_input: Locator = self.by_test_id("password")
        self.submit_button: Locator = self.by_role("button", name="Log in")
        self.flash: Locator = self.by_test_id("flash")

    def login(self, username: str, password: str) -> None:
        """Fill the credentials and submit the form.

        Credentials must come from the ``credentials`` fixture, never from
        literals in test code (FR-AUT-005). Interactions go through the
        instrumented BasePage helpers so the live timeline shows each
        fill/click (FR-EXE-007); the password value is redacted (SEC-007).
        """
        self.fill(self.username_input, username, "Username")
        self.fill(self.password_input, password, "Password")
        self.click(self.submit_button, "Log in")

    def assert_flash_contains(self, text: str) -> None:
        """Web-first assertion on the flash message text (FR-AUT-004)."""
        expect(self.flash).to_contain_text(text)
