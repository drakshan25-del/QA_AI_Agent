from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class SampleLoginPage(BasePage):
    """Page object for https://practicetestautomation.com/practice-test-login.

    The project ``base_url`` is already the full login-page URL, so navigation
    goes straight to it — no extra path is appended.
    """

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_field: Locator = page.locator("#username")
        self.password_field: Locator = page.locator("#password")
        self.submit_button: Locator = page.locator("#submit")
        self.error_message: Locator = page.locator("#error")
        self.success_heading: Locator = page.get_by_role(
            "heading", name="Logged In Successfully"
        )

    def open(self) -> None:
        """Navigate directly to the login page (base_url), no path appended."""
        self.page.goto(self.base_url)

    def login(self, username: str, password: str) -> None:
        self.open()
        self.fill(self.username_field, username, name="Username")
        self.fill(self.password_field, password, name="Password")
        self.click(self.submit_button, type="Submit")
        self.assert_contains_text(self.success_heading, "Logged In Successfully", name="Success Heading")