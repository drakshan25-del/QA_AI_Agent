import pytest
from playwright.sync_api import Page, expect

from automation.pages.keepme_login_page import KeepmeLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-001 Successful login with valid credentials
# REQ: 
def test_successful_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.fill_email(credentials.username)
    login.fill_password(credentials.password)
    login.submit()
    expect(page).to_have_url("/practice-test-dashboard/")

# TC: TC-002 Invalid credentials with wrong email
# REQ: 
def test_invalid_email_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.fill_email("wronguser@example.com")
    login.fill_password("securePassword123")
    login.submit()
    expect(login.error_message).to_be_visible()
    expect(login.error_message).to_contain_text("Invalid email or password")
    expect(login.email_field).to_have_value("wronguser@example.com")
    expect(login.password_field).to_have_value("")

# TC: TC-003 Invalid credentials with wrong password
# REQ: 
def test_invalid_password_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.fill_email("user@example.com")
    login.fill_password("securePassword123")
    login.submit()
    expect(login.error_message).to_be_visible()
    expect(login.error_message).to_contain_text("Invalid email or password")
    expect(login.email_field).to_have_value("user@example.com")
    expect(login.password_field).to_have_value("")

# TC: TC-004 Invalid credentials with empty fields
# REQ: 
def test_empty_credentials_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.submit()
    expect(login.error_message).to_be_visible()
    expect(login.error_message).to_contain_text("Invalid email or password")
    expect(login.email_field).to_have_value("")
    expect(login.password_field).to_have_value("")
