from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage

class SampleLoginPage(BasePage):
    path = '/login'

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.email_field: Locator = self.get_by_label('Username')
        self.password_field: Locator = self.get_by_label('Password')
        self.login_button: Locator = self.get_by_role('button', name='Login')
        self.flash: Locator = self.get_by_role('alert')
        self.error_message: Locator = self.get_by_role('alert', name='Your username is invalid! Please try again.')

    def goto(self) -> None:
        self.page.goto(self.path)

    def enter_email(self, email: str) -> None:
        self.fill(self.email_field, email)

    def login(self, password: str) -> None:
        self.enter_email('user@example.com')
        self.fill(self.password_field, password)
        self.click(self.login_button)