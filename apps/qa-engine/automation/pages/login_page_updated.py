from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class LoginPage(BasePage):
    """Login page of the application under test."""

    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_input: Locator = self.by_test_id("username")
        self.password_input: Locator = self.by_test_id("password")
        self.submit_button: Locator = self.by_role("button", name="Log in")

    def login(self, username: str, password: str) -> None:
        """Fill credentials and submit the login form."""
        self.fill(self.username_input, username, "Username")
        self.fill(self.password_input, password, "Password")
        self.click(self.submit_button, "Log in")

    def navigate_to_login(self) -> None:
        """Navigate to the login page."""
        self.goto()
