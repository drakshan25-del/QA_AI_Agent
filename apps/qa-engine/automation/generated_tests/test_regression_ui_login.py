# TC: TC-401 Valid login lands on items with a welcome message
# REQ: REQ-UI-1
import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated, pytest.mark.regression]

def test_valid_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    # Successful login already redirects to /items; navigating again would
    # consume the one-shot flash before the assertion sees it.
    expect(login.flash).to_contain_text("Welcome")

# TC: TC-402 Invalid login shows the exact 'Invalid credentials' message
# REQ: REQ-UI-1
def test_invalid_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, "wrong_password")
    expect(login.flash).to_contain_text("Invalid credentials")