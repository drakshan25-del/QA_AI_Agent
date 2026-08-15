from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class ItemsPage(BasePage):
    path = "/items"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.empty_state: Locator = self.page.get_by_text(
            "No items yet. Add one to get started."
        )
        self.item_list: Locator = self.by_role("list", name="Items")

    def goto(self) -> None:
        self.navigate(self.path)

    def item_by_text(self, text: str) -> Locator:
        return self.page.get_by_text(text, exact=True)
