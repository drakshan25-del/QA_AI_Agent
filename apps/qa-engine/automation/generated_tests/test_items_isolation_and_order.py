import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page import LoginPage
from automation.pages.items_page import ItemsPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]


# TC: TC-004 User B sees only empty state, not User A's items
# REQ: REQ-ITEMS-ISOLATION
def test_user_b_sees_only_empty_state(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)

    items = ItemsPage(page, base_url)
    items.goto()

    expect(items.empty_state).to_be_visible()
    expect(page.get_by_text("Buy groceries")).to_have_count(0)
    expect(page.get_by_text("Walk the dog")).to_have_count(0)
    expect(page.get_by_text("Pay bills")).to_have_count(0)


# TC: TC-001 Items displayed in creation order for account with 3 items
# REQ: REQ-ITEMS-ORDER
def test_items_displayed_in_creation_order(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)

    items = ItemsPage(page, base_url)
    items.goto()

    item1 = items.item_by_text("Buy groceries")
    item2 = items.item_by_text("Walk the dog")
    item3 = items.item_by_text("Pay bills")

    expect(item1).to_be_visible()
    expect(item2).to_be_visible()
    expect(item3).to_be_visible()

    all_items = items.item_list.locator("li")
    expect(all_items).to_have_count(3)
    expect(all_items.nth(0)).to_contain_text("Buy groceries")
    expect(all_items.nth(1)).to_contain_text("Walk the dog")
    expect(all_items.nth(2)).to_contain_text("Pay bills")
