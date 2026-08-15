from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class UserCreationPage(BasePage):
    """User creation form page for administrators."""

    path = "/users/create"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        # Note: Page structure was not provided for /users/create.
        # Using conservative locators based on test case field names.
        # Human review recommended.
        self.full_name_input: Locator = self.get_by_label("Full name", exact=False)
        self.email_input: Locator = self.get_by_label("Email", exact=False)
        self.password_input: Locator = self.get_by_label("Password", exact=False)
        self.password_confirmation_input: Locator = self.get_by_label("Password confirmation", exact=False)
        self.role_select: Locator = self.get_by_label("Role", exact=False)
        self.submit_button: Locator = self.by_role("button", name="Submit")
        self.success_message: Locator = self.page.locator("text=User created successfully")
        self.validation_error: Locator = self.page.locator("[role=alert], .error, .validation-error").first

    def create_user(
        self,
        full_name: str,
        email: str,
        password: str,
        password_confirmation: str,
        role: str,
    ) -> None:
        """Fill and submit the user creation form."""
        self.fill(self.full_name_input, full_name, "Full name")
        self.fill(self.email_input, email, "Email")
        self.fill(self.password_input, password, "Password")
        self.fill(self.password_confirmation_input, password_confirmation, "Password confirmation")
        self.select(self.role_select, role, "Role")
        self.click(self.submit_button, "Submit")
