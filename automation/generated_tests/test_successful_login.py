import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-001 Successful Login with Valid Credentials
# REQ: REQ-1

def test_successful_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login("student", "Password123")
    expect(page).to_have_url("/logged-in-successfully/")