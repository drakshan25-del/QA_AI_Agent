"""Hand-written smoke suite for the sample target app (FR-AUT-001, FR-AUT-004).

These tests double as the reference style for AI-generated tests: page objects
from ``automation.pages``, accessibility-first locators (FR-AUT-003), web-first
``expect()`` assertions with no sleeps (FR-AUT-004), and configuration taken
only from fixtures (FR-AUT-005). Each test carries ``# TC:`` / ``# REQ:``
traceability comments (FR-AUT-006) and skips cleanly when the target app is
not running (via ``target_available``).
"""

from __future__ import annotations

import uuid

import pytest
from playwright.sync_api import Page

from automation.pages.sample_items_page import SampleItemsPage
from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.smoke]


# TC: SMOKE-001 Successful login shows welcome message
# REQ: FR-AUT-001, FR-AUT-004
def test_successful_login_shows_welcome(
    page: Page, base_url: str, credentials, target_available
) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    login.assert_flash_contains("Welcome")


# TC: SMOKE-002 Failed login shows invalid credentials message
# REQ: FR-AUT-001, FR-AUT-004
def test_failed_login_shows_invalid_credentials(
    page: Page, base_url: str, credentials, target_available
) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, "wrong-" + credentials.password)
    login.assert_flash_contains("Invalid credentials")


# TC: SMOKE-003 Added item appears in the items list
# REQ: FR-AUT-001, FR-AUT-004
def test_add_item_appears_in_list(
    page: Page, base_url: str, credentials, target_available
) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)

    items = SampleItemsPage(page, base_url)
    items.goto()
    item_text = f"smoke-item-{uuid.uuid4().hex[:8]}"
    items.add_item(item_text)
    items.assert_item_present(item_text)
