import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-001 Successful Login with Valid Credentials
# REQ: REQ-1

def test_successful_login_with_valid_credentials(page: Page, base_url: str, credentials, target_available) -> None:
    login_page = SampleLoginPage(page, base_url)
    login_page.goto()
    login_page.enter_email(credentials.username)
    login_page.enter_password(credentials.password)
    login_page.click_login_button()
    expect(login_page.flash).to_contain_text('Welcome')

# TC: TC-002 Invalid Credentials - Wrong Email
# REQ: REQ-1

def test_invalid_credentials_wrong_email(page: Page, base_url: str, credentials, target_available) -> None:
    login_page = SampleLoginPage(page, base_url)
    login_page.goto()
    login_page.enter_email(credentials.username.replace('test', 'wrong'))
    login_page.enter_password(credentials.password)
    login_page.click_login_button()
    expect(login_page.error_message).to_contain_text('Invalid email or password')

# TC: TC-003 Invalid Credentials - Wrong Password
# REQ: REQ-1

def test_invalid_credentials_wrong_password(page: Page, base_url: str, credentials, target_available) -> None:
    login_page = SampleLoginPage(page, base_url)
    login_page.goto()
    login_page.enter_email(credentials.username)
    login_page.enter_password(credentials.password.replace('test', 'wrong'))
    login_page.click_login_button()
    expect(login_page.error_message).to_contain_text('Invalid email or password')

# TC: TC-004 Validation - Empty Email
# REQ: REQ-1

def test_validation_empty_email(page: Page, base_url: str, credentials, target_available) -> None:
    login_page = SampleLoginPage(page, base_url)
    login_page.goto()
    login_page.enter_email('')
    login_page.enter_password(credentials.password)
    login_page.click_login_button()
    expect(login_page.email_field).to_have_attribute('aria-invalid', 'true')