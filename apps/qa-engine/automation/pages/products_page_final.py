from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class ProductsPage(BasePage):
    """Product management page (/products) — create and list products."""

    path = "/products"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.name_field: Locator = self.by_test_id("product-name")
        self.category_field: Locator = self.by_test_id("product-category")
        self.price_field: Locator = self.by_test_id("product-price")
        self.stock_field: Locator = self.by_test_id("product-stock")
        self.submit_button: Locator = self.by_role("button", name="Save product")
        self.product_rows: Locator = self.by_test_id("product-row")

    def create_product(self, name: str, category: str, price: str, stock: str) -> None:
        """Fill and submit the product creation form."""
        if name:
            self.fill(self.name_field, name, "Product name")
        if category:
            self.fill(self.category_field, category, "Category")
        if price:
            self.fill(self.price_field, price, "Price")
        if stock:
            self.fill(self.stock_field, stock, "Stock quantity")
        self.click(self.submit_button, "Save product")

    def product_row_by_name(self, name: str) -> Locator:
        """Return the product row containing the given product name."""
        return self.page.locator(f'[data-testid="product-row"]:has-text("{name}")')