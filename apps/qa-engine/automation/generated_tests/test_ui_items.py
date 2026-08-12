import uuid

import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_items_page import SampleItemsPage
from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]
# TC: TC-201 Add item appears in the items list
# REQ: REQ-UI-2
def test_add_item_appears_in_list(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    items_page = SampleItemsPage(page, base_url)
    items_page.goto()
    item_text = f'ui-item-add-{uuid.uuid4().hex[:8]}'
    items_page.add_item(item_text)
    expect(items_page.item_with_text(item_text)).to_have_count(1)

# TC: TC-202 Deleted item disappears from the items list
# REQ: REQ-UI-2
def test_deleted_item_disappears(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    items_page = SampleItemsPage(page, base_url)
    items_page.goto()
    item_text = f'ui-item-delete-{uuid.uuid4().hex[:8]}'
    items_page.add_item(item_text)
    expect(items_page.item_with_text(item_text)).to_have_count(1)
    items_page.delete_item_by_text(item_text)
    expect(items_page.item_with_text(item_text)).to_have_count(0)

# TC: TC-203 Blank item text is not added to the list
# REQ: REQ-UI-2
def test_blank_item_not_added(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    items_page = SampleItemsPage(page, base_url)
    items_page.goto()
    count_before = items_page.items.count()
    items_page.add_item('')
    expect(items_page.items).to_have_count(count_before)