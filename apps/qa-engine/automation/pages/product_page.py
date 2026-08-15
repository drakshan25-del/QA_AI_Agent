from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class ProductPage(BasePage):
    path = "/products/create"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.name_field: Locator = self.by_label("Name")
        self.category_select: Locator = self.by_label("Category")
        self.price_field: Locator = self.by_label("Price")
        self.stock_field: Locator = self.by_label("Stock")
        self.submit_button: Locator = self.by_role("button", name="Submit")
        self.success_message: Locator = self.page.get_by_text(
            "Product created successfully"
        )

    def goto(self) -> None:
        self.navigate(self.path)

    def create_product(self, name: str, category: str, price: str, stock: str) -> None:
        self.fill(self.name_field, name, "Name field")
        self.select(self.category_select, category, "Category select")
        self.fill(self.price_field, price, "Price field")
        self.fill(self.stock_field, stock, "Stock field")
        self.click(self.submit_button, "Submit button")

    def product_row(self, name: str) -> Locator:
        return self.page.get_by_role("row", name=name)
