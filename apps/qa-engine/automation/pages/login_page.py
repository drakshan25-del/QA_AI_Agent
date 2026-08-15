from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class LoginPage(BasePage):
    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_input: Locator = self.get_by_label("username", exact=False)
        self.password_input: Locator = self.get_by_label("password", exact=False)
        # Contract documented in sample_app/main.py: button 'Log in',
        # flash messages render as <div data-testid="flash"> (no ARIA alert).
        self.submit_button: Locator = self.by_role("button", name="Log in", exact=False)
        self.error_message: Locator = self.by_test_id("flash")

    def navigate_to_login(self) -> None:
        """Navigate to the login page."""
        self.page.goto(f"{self.base_url}{self.path}")

    def login(self, username: str, password: str) -> None:
        """Fill in username and password and submit the login form."""
        if username:
            self.fill(self.username_input, username, "Username field")
        if password:
            self.fill(self.password_input, password, "Password field")
        self.click(self.submit_button, "Submit button")
