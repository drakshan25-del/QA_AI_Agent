import uuid

import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_items_page import SampleItemsPage
from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated, pytest.mark.regression]
# TC: TC-403 Added item appears exactly once (no duplicates)
# REQ: REQ-UI-2
def test_added_item_appears_once(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    items_page = SampleItemsPage(page, base_url)
    items_page.goto()
    item_text = f'reg-ui-once-{uuid.uuid4().hex[:8]}'
    items_page.add_item(item_text)
    expect(items_page.item_with_text(item_text)).to_have_count(1)

# TC: TC-404 Deleting an item actually removes it
# REQ: REQ-UI-2
def test_deleting_item_removes_it(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    items_page = SampleItemsPage(page, base_url)
    items_page.goto()
    item_text = f'reg-ui-delete-{uuid.uuid4().hex[:8]}'
    items_page.add_item(item_text)
    items_page.delete_item_by_text(item_text)
    expect(items_page.item_with_text(item_text)).to_have_count(0)
