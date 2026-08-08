from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage

class LoginPage(BasePage):
    """Login page of practicetestautomation.com (username/password form)."""

    path = '/practice-test-login/'

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.username_field: Locator = self.get_by_label('Username')
        self.password_field: Locator = self.get_by_label('Password')
        self.submit_button: Locator = self.get_by_role('button', name='Submit')
        # The site renders validation errors in a plain <div id="error"> with
        # no ARIA role, so the id is the only stable locator for it.
        self.error_message: Locator = page.locator('#error')
        self.flash: Locator = self.get_by_role('heading', name='Logged In Successfully')

    def enter_username(self, username: str) -> None:
        self.fill(self.username_field, username, label='Username')

    def enter_password(self, password: str) -> None:
        self.fill(self.password_field, password, label='Password')

    def submit(self) -> None:
        self.click(self.submit_button, label='Submit')
