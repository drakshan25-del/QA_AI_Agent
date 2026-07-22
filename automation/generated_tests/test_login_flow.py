import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-001 Valid Email and Password Login
# REQ: REQ-1,REQ-2

def test_valid_email_password_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    page.wait_for_timeout(60000)
    login.login(credentials.username, credentials.password)
    expect(login.flash).to_contain_text('Welcome')

# TC: TC-002 Invalid Email Login
# REQ: REQ-1,REQ-3

def test_invalid_email_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    page.wait_for_timeout(60000)
    login.enter_email('invaliduser@example.com')
    login.login(credentials.password)
    expect(login.error_message).to_contain_text('Your username is invalid! Please try again.')

# TC: TC-003 Invalid Password Login
# REQ: REQ-1,REQ-4

def test_invalid_password_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    page.wait_for_timeout(60000)
    login.enter_email(credentials.username)
    login.login('wrongPassword123')
    expect(login.error_message).to_contain_text('Your password is invalid! Please try again.')

# TC: TC-004 Empty Email and Password Fields
# REQ: REQ-1,REQ-5

def test_empty_fields_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = SampleLoginPage(page, base_url)
    login.goto()
    page.wait_for_timeout(60000)
    login.login('', '')
    expect(login.error_message).to_contain_text('Your username is invalid! Please try again.')