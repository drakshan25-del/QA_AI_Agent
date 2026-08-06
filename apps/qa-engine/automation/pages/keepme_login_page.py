"""Page object for the KeepMe Control Centre staging login page (FR-AUT-001/003).

Contract observed on https://agentstaging.keepme.ai/login (rendered DOM,
2026-07-16):

* email input: ``placeholder="your@email.com"`` (label 'Email*' is not
  programmatically associated, so the placeholder is the accessible hook);
* password input: ``placeholder="************"``;
* submit button: role ``button``, accessible name ``Sign In`` (plus separate
  Google / Microsoft OAuth buttons that these tests never click);
* feedback: toasts rendered with ``role=alert`` — a failed login shows
  'Operation Failed / Invalid Credentials' and the page stays on ``/login``;
  a successful login navigates away from ``/login``.
"""

from __future__ import annotations

from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class KeepmeLoginPage(BasePage):
    """Login page of the KeepMe Control Centre (staging)."""

    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.email_input: Locator = self.by_placeholder("your@email.com")
        self.password_input: Locator = self.by_placeholder("************")
        self.sign_in_button: Locator = self.by_role("button", name="Sign In")
        self.alerts: Locator = page.get_by_role("alert")

    def login(self, email: str, password: str) -> None:
        """Fill the credentials and submit the form.

        Credentials must come from the ``credentials`` fixture, never from
        literals in test code (FR-AUT-005). Interactions use the instrumented
        BasePage helpers so the live timeline shows each fill/click
        (FR-EXE-007); the password value is redacted (SEC-007).
        """
        self.fill(self.email_input, email, "email")
        self.fill(self.password_input, password, "password")
        self.click(self.sign_in_button, "Sign In")

    def assert_alert_contains(self, text: str) -> None:
        """Web-first assertion that a toast/alert containing ``text`` appears."""
        self.assert_visible(self.alerts.filter(has_text=text).first)

    def assert_still_on_login(self) -> None:
        """Assert the browser stayed on the login page (failed login)."""
        self.assert_url_contains("/login")

    def assert_left_login(self) -> None:
        """Assert the browser navigated away from /login (successful login)."""
        self.assert_url_not_contains("/login")
