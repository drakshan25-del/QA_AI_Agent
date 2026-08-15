import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page_final import LoginPage
from automation.pages.products_page_final import ProductsPage
from automation.pages.dashboard_page_final import DashboardPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]


# TC: TC-001 Create product with all valid required fields and no image
# REQ: 2cf398f9-4c3b-4c9b-b991-bc6c0f4a4127
def test_create_product_with_valid_required_fields(
    page: Page, base_url: str, credentials, target_available
) -> None:
    """Verify that a product can be created with all valid required fields and no image."""
    # Authenticate first (page requires login)
    login_page = LoginPage(page, base_url)
    login_page.goto()
    login_page.login(credentials.username, credentials.password)
    expect(page).to_have_url(f"{base_url}/dashboard")

    # Capture initial total products count
    dashboard = DashboardPage(page, base_url)
    initial_count = dashboard.get_total_products_count()

    # Navigate to products page and create product
    products_page = ProductsPage(page, base_url)
    products_page.goto()
    products_page.create_product(
        name="Wireless Mouse",
        category="Electronics",
        price="29.99",
        stock="150"
    )

    # Assert product appears in the product list
    expect(products_page.product_row_by_name("Wireless Mouse")).to_be_visible()

    # Navigate to dashboard and verify product appears in recent products
    dashboard.goto()
    expect(page).to_have_url(f"{base_url}/dashboard")
    assert dashboard.product_appears_in_recent("Wireless Mouse"), "Product should appear in recent products"

    # Verify total products count increased by 1
    new_count = dashboard.get_total_products_count()
    assert new_count == initial_count + 1, f"Total products should increase by 1 (was {initial_count}, now {new_count})"


# TC: TC-003 Reject product creation when product name is missing
# REQ: 2cf398f9-4c3b-4c9b-b991-bc6c0f4a4127
def test_reject_product_creation_when_name_missing(
    page: Page, base_url: str, credentials, target_available
) -> None:
    """Verify that product creation is rejected when product name is missing (client-side validation)."""
    # Authenticate first
    login_page = LoginPage(page, base_url)
    login_page.goto()
    login_page.login(credentials.username, credentials.password)
    expect(page).to_have_url(f"{base_url}/dashboard")

    # Capture initial total products count
    dashboard = DashboardPage(page, base_url)
    initial_count = dashboard.get_total_products_count()

    # Navigate to products page
    products_page = ProductsPage(page, base_url)
    products_page.goto()

    # Attempt to create product with empty name (required field)
    products_page.create_product(
        name="",
        category="Electronics",
        price="29.99",
        stock="100"
    )

    # Assert client-side validation blocks submission (URL unchanged)
    expect(page).to_have_url(f"{base_url}/products")

    # Verify total products count has not changed
    dashboard.goto()
    new_count = dashboard.get_total_products_count()
    assert new_count == initial_count, f"Total products should not change (was {initial_count}, now {new_count})"


# TC: TC-010 Reject product creation when price is negative
# REQ: 2cf398f9-4c3b-4c9b-b991-bc6c0f4a4127
def test_reject_product_creation_when_price_negative(
    page: Page, base_url: str, credentials, target_available
) -> None:
    """Verify that product creation is rejected when price is negative (client-side validation)."""
    # Authenticate first
    login_page = LoginPage(page, base_url)
    login_page.goto()
    login_page.login(credentials.username, credentials.password)
    expect(page).to_have_url(f"{base_url}/dashboard")

    # Capture initial total products count
    dashboard = DashboardPage(page, base_url)
    initial_count = dashboard.get_total_products_count()

    # Navigate to products page
    products_page = ProductsPage(page, base_url)
    products_page.goto()

    # Attempt to create product with negative price (violates min=0)
    products_page.create_product(
        name="Refund Item",
        category="Electronics",
        price="-10.50",
        stock="20"
    )

    # Assert client-side validation blocks submission (URL unchanged)
    expect(page).to_have_url(f"{base_url}/products")

    # Verify total products count has not changed
    dashboard.goto()
    new_count = dashboard.get_total_products_count()
    assert new_count == initial_count, f"Total products should not change (was {initial_count}, now {new_count})"

    # Verify the product does not appear in the product list
    products_page.goto()
    expect(products_page.product_row_by_name("Refund Item")).not_to_be_visible()