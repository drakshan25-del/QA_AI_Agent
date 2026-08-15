from playwright.sync_api import Locator, Page, expect

from automation.pages.base_page import BasePage


class AdminLoginPage(BasePage):
    """Admin login page for the application under test."""
    
    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.email_input: Locator = self.by_test_id("username")
        self.password_input: Locator = self.by_test_id("password")
        self.submit_button: Locator = self.by_role("button", name="Log in")
        self.error_message: Locator = self.by_test_id("flash")

    def login(self, email: str, password: str) -> None:
        """Fill in email and password and submit the login form."""
        self.fill(self.email_input, email, "Email input")
        self.fill(self.password_input, password, "Password input")
        self.click(self.submit_button, "Submit button")

    def assert_still_on_login(self) -> None:
        """Assert that the user is still on the login page."""
        expect(self.page).to_have_url(f"{self.base_url}{self.path}")
