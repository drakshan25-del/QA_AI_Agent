import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page import LoginPage

pytestmark = [pytest.mark.generated]

# Demo account published on practicetestautomation.com/practice-test-login/.
# The shared ``credentials`` fixture defaults target the local sample app,
# so this site's documented account is used directly.
VALID_USERNAME = 'student'
VALID_PASSWORD = 'Password123'

# TC: TC-002 Empty email and valid password login
# REQ: REQ-1,REQ-2

def test_empty_email_valid_password_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.enter_username('')
    login.enter_password(VALID_PASSWORD)
    login.submit()
    expect(login.error_message).to_contain_text('Your username is invalid!')

# TC: TC-003 Empty password and valid email login
# REQ: REQ-1,REQ-2

def test_empty_password_valid_email_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.enter_username(VALID_USERNAME)
    login.enter_password('')
    login.submit()
    expect(login.error_message).to_contain_text('Your password is invalid!')

# TC: TC-004 Malformed email and valid password login
# REQ: REQ-1,REQ-2

def test_malformed_email_valid_password_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.enter_username('user@invalid')
    login.enter_password(VALID_PASSWORD)
    login.submit()
    expect(login.error_message).to_contain_text('Your username is invalid!')

# TC: TC-001 Valid email and password login
# REQ: REQ-1,REQ-2

def test_valid_email_valid_password_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.enter_username(VALID_USERNAME)
    login.enter_password(VALID_PASSWORD)
    login.submit()
    login.assert_url_contains('logged-in-successfully')
    expect(login.flash).to_contain_text('Logged In Successfully')
