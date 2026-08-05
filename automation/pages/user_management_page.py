from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage

class UserManagementPage(BasePage):
    path = '/web/index.php/admin/userManagement'

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.create_new_user_link: Locator = self.get_by_role('link', name='Add')
        self.username_input: Locator = self.get_by_placeholder('Username')
        self.password_input: Locator = self.get_by_placeholder('Password')
        self.confirm_password_input: Locator = self.get_by_placeholder('Confirm Password')
        self.save_button: Locator = self.get_by_role('button', name='Save')