import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page import LoginPage
from automation.pages.product_page import ProductPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]


# TC: TC-001 Create product with all valid required fields and no image
# REQ: REQ-PRODUCT-CREATE
def test_create_product_valid_fields_no_image(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)

    product_page = ProductPage(page, base_url)
    product_page.goto()
    product_page.create_product(
        name="Widget A",
        category="Tools",
        price="19.99",
        stock="10",
    )

    expect(product_page.success_message).to_be_visible()
    row = product_page.product_row("Widget A")
    expect(row).to_be_visible()
    expect(row).to_contain_text("19.99")
