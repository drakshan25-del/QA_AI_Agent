from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class DashboardPage(BasePage):
    path = "/dashboard"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)

    def navigation_link(self, name: str) -> Locator:
        return self.by_role("link", name=name, exact=False)

    def assert_navigation_link_visible(self, name: str) -> None:
        from playwright.sync_api import expect
        link = self.navigation_link(name)
        expect(link).to_be_visible()
