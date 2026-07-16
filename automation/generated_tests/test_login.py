import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-001 User logs in with valid credentials
# REQ: 709de708956c4e58ab7257c74c862b56
def test_valid_login(page: Page, base_url: str, credentials, target_available):
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    expect(login.flash).to_contain_text('Welcome')

# TC: TC-002 User logs in with incorrect password
# REQ: 709de708956c4e58ab7257c74c862b56
def test_incorrect_password_login(page: Page, base_url: str, credentials, target_available):
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, 'incorrect_password')
    expect(login.flash).to_contain_text('Invalid credentials')

# TC-003 User logs in with unknown username
# REQ: 709de708956c4e58ab7257c74c862b56
def test_unknown_username_login(page: Page, base_url: str, credentials, target_available):
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login('unknown_username', credentials.password)
    expect(login.flash).to_contain_text('Invalid credentials')

# TC-004 User logs in with empty username
# REQ: 709de708956c4e58ab7257c74c862b56
def test_empty_username_login(page: Page, base_url: str, credentials, target_available):
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login('', credentials.password)
    expect(login.flash).to_contain_text('Invalid credentials')

# TC-005 User logs in with empty password
# REQ: 709de708956c4e58ab7257c74c862b56
def test_empty_password_login(page: Page, base_url: str, credentials, target_available):
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, '')
    expect(login.flash).to_contain_text('Invalid credentials')

# TC-006 User logs in with empty username and password
# REQ: 709de708956c4e58ab7257c74c862b56
def test_empty_username_password_login(page: Page, base_url: str, credentials, target_available):
    login = SampleLoginPage(page, base_url)
    login.goto()
    login.login('', '')
    expect(login.flash).to_contain_text('Invalid credentials')