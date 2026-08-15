from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class UserCreationPage(BasePage):
    """Admin user management page (/admin) — create and list admin users.

    Requires an authenticated admin session: log in via LoginPage first.
    Locators mirror the real markup: form data-testid="admin-form" with
    admin-name / admin-email / admin-password inputs, admin-role and
    admin-status selects, submit button "Save admin", rows "admin-row".
    """

    path = "/admin"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.form: Locator = self.by_test_id("admin-form")
        self.name_input: Locator = self.by_test_id("admin-name")
        self.email_input: Locator = self.by_test_id("admin-email")
        self.password_input: Locator = self.by_test_id("admin-password")
        self.role_select: Locator = self.by_test_id("admin-role")
        self.status_select: Locator = self.by_test_id("admin-status")
        self.submit_button: Locator = self.by_role("button", name="Save admin")
        self.flash: Locator = self.by_test_id("flash")
        self.rows: Locator = self.by_test_id("admin-row")

    def create_user(self, name: str, email: str, password: str, role: str = "admin") -> None:
        """Fill and submit the create form; empty values leave fields blank."""
        if name:
            self.fill(self.name_input, name, "Full name")
        if email:
            self.fill(self.email_input, email, "Email address")
        if password:
            self.fill(self.password_input, password, "Password")
        if role:
            self.select(self.role_select, role, "Role")
        self.click(self.submit_button, "Save admin")

    def row_for(self, email: str) -> Locator:
        """The admin table row containing the given email."""
        return self.rows.filter(has_text=email)
