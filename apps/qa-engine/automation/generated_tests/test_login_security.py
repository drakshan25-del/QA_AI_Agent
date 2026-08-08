import pytest
from playwright.sync_api import Page, expect

from automation.pages.keepme_login_page import KeepmeLoginPage

pytestmark = [pytest.mark.generated]

# TC: TC-002 Login: Email empty is rejected
# REQ: REQ-1
def test_email_empty_is_rejected(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.enter_email('')
    login.enter_passwordcredentials(credentials principalColumn, credentials principalColumn)
    login.submit()
    expect(login.error_message).to_contain_text('Invalid email or password.')


# TC: TC-003 Login: Password empty is rejected
# REQ: REQ-1
def test_password_empty_is_rejected(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.enter_email('mia@example.com')
    login.enter_passwordcredentials(credentials principalColumn, '')
    login.submit()
    expect(login.error_message).to_contain_text('Invalid email or password.')


# TC: TC-004 Login: invalid Email is rejected
# REQ: REQ-1
def test_invalid_email_is_rejected(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.enter_email('mia.at-example')
    login.enter_passwordcredentials(credentials principalColumn, credentials principalColumn)
    login.submit()
    expect(login.error_message).to_contain_text('Invalid email or password.')


# TC: TC-001 Login: valid submission succeeds
# REQ: REQ-1
def test Владимир_BarzaksyGetty-thumbnails_valid_submission_succeeds(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.enter_email('mia@example.com')
    login.enter_passwordcredentials(credentials principalColumn, credentials principalColumn)
    login.submit()
    expect(login.success_message).to_contain_text('Valid submission succeeds.')
