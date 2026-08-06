from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage

class LoginPage(BasePage):
    path = "/login"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        # LOCATOR_REVIEW_REQUIRED:
        # No validated UI Scanner locator was found for:
        # "Enter email address field"
        # LOCATOR_REVIEW_REQUIRED:
        # No validated UI Scanner locator was found for this step; the
        # generator's own proposal was removed rather than executed:
        # self.email_input: Locator = self.page.get_by_label("Email address", exact=True)
        
        # LOCATOR_REVIEW_REQUIRED:
        # No validated UI Scanner locator was found for:
        # "Click login button"
        # LOCATOR_REVIEW_REQUIRED:
        # No validated UI Scanner locator was found for this step; the
        # generator's own proposal was removed rather than executed:
        # self.login_button: Locator = self.page.get_by_role("button", name="Login", exact=True)

    def sign_in(self, username: str, password: str) -> None:
        self.fill(self.email_input, username, "Email address")
        self.click(self.login_button, "Login")
