import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-003 Authenticate with valid credentials - Boundary case
# REQ: 895c12dd81e14620bac5b1c4cbdb9044
def test_boundary_case_valid_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login('a', credentials.password)
    expect(login.flash).to_contain_text('User is redirected to the default authorized landing page or Metrics page.')
