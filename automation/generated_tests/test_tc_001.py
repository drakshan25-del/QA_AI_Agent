import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-001 Authenticate with valid credentials - Positive case
# REQ: 895c12dd81e14620bac5b1c4cbdb9044
def test_valid_login_positive_case(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    expect(login.flash).to_contain_text('User is redirected to the default authorized landing page or Metrics page.')
