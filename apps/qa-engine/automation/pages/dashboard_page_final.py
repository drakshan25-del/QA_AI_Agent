from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class DashboardPage(BasePage):
    """Dashboard page showing metrics and recent activity."""

    path = "/dashboard"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.stat_total_products: Locator = self.by_test_id("stat-total-products")
        self.recent_products: Locator = self.by_test_id("recent-products")
        self.recent_product: Locator = self.by_test_id("recent-product")

    def get_total_products_count(self) -> int:
        """Extract the total products count from the stat element."""
        text = self.stat_total_products.inner_text()
        # Extract numeric value from text like "Total Products: 42" or just "42"
        import re
        match = re.search(r'\d+', text)
        return int(match.group()) if match else 0

    def product_appears_in_recent(self, product_name: str) -> bool:
        """Check if a product appears in the recent products list."""
        return self.page.locator(f'[data-testid="recent-product"]:has-text("{product_name}")').count() > 0