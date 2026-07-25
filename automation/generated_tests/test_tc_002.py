import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-002 Authenticate with valid credentials - Negative case
# REQ: 895c12dd81e14620bac5b1c4cbdb9044
def test_invalid_login_negative_case(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login('user123', 'invalid_password')
    expect(login.flash).to_contain_text('Access is denied.')
