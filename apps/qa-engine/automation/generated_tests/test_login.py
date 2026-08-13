import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page import LoginPage
from automation.pages.sample_items_page import SampleItemsPage

pytestmark = [pytest.mark.generated]
# TC: a35396f7-9f2a-49f2-b536-17f3e6e0654d User logs in with valid credentials from login page
# REQ: REQ-1,REQ-2
def test_user_logs_in_with_valid_credentials_from_login_page(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    expect(page).to_have_url(base_url + '/web/index.php/dashboard')

# TC: 7c1811f1-3285-40c8-99d1-5b83757b517f User logs in with valid credentials from non-login page
# REQ: REQ-1,REQ-2
def test_user_logs_in_with_valid_credentials_from_non_login_page(page: Page, base_url: str, credentials, target_available) -> None:
    non_login_page = SampleItemsPage(page, base_url)
    non_login_page.goto()
    non_login_page.click(non_login_page.login_link)
    login = LoginPage(page, base_url)
    login.login(credentials.username, credentials.password)
    expect(page).to_have_url(base_url + '/web/index.php/dashboard')