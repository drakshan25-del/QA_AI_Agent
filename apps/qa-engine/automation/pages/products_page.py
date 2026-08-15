from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class ProductsPage(BasePage):
    """Product management page (/products) — create and list products.

    Requires an authenticated admin session. The Category field is a text
    input with datalist autocomplete suggestions — it is typed into with
    fill(), never select_option. Server feedback renders in the
    data-testid="flash" element; invalid submits (missing required fields,
    price below min=0) are blocked client-side by the browser.
    """

    path = "/products"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.name_field: Locator = self.by_test_id("product-name")
        self.category_field: Locator = self.by_test_id("product-category")
        self.price_field: Locator = self.by_test_id("product-price")
        self.stock_field: Locator = self.by_test_id("product-stock")
        self.submit_button: Locator = self.by_role("button", name="Save product")
        self.flash: Locator = self.by_test_id("flash")

    def create_product(self, name: str, category: str, price: str, stock: str) -> None:
        """Fill and submit the create form; empty values leave fields blank."""
        if name:
            self.fill(self.name_field, name, "Product name")
        if category:
            self.fill(self.category_field, category, "Category")
        if price:
            self.fill(self.price_field, price, "Price")
        if stock:
            self.fill(self.stock_field, stock, "Stock quantity")
        self.click(self.submit_button, "Save product")
