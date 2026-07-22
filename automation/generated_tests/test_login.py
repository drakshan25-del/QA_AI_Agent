import re

import pytest
from playwright.sync_api import Page, expect

from automation.pages.sample_login_page import SampleLoginPage

pytestmark = [pytest.mark.generated]

# Public, documented practice credentials for practicetestautomation.com.
VALID_USERNAME = "student"
VALID_PASSWORD = "Password123"

# NOTE: these tests deliberately do NOT depend on the ``target_available``
# fixture. That fixture probes the target with httpx, which cannot pass the
# Cloudflare JS challenge fronting practicetestautomation.com (it returns
# 406/409 to non-browser clients) and would spuriously skip the suite. A real
# Chromium browser solves the challenge, so we let the browser navigate.


# TC-001 Valid Email and Password Login
# REQ: REQ-1,REQ-2
def test_valid_email_password_login(page: Page, base_url: str) -> None:
    login = SampleLoginPage(page, base_url)
    login.login(VALID_USERNAME, VALID_PASSWORD)
    expect(page).to_have_url(re.compile(r".*logged-in-successfully.*"))
    expect(login.success_heading).to_be_visible()


# TC-002 Invalid Email Login
# REQ: REQ-1,REQ-3
def test_invalid_email_login(page: Page, base_url: str) -> None:
    login = SampleLoginPage(page, base_url)
    login.login("incorrectUser", VALID_PASSWORD)
    expect(login.error_message).to_contain_text("Your username is invalid!")


# TC-003 Invalid Password Login
# REQ: REQ-1,REQ-4
def test_invalid_password_login(page: Page, base_url: str) -> None:
    login = SampleLoginPage(page, base_url)
    login.login(VALID_USERNAME, "wrongPassword")
    expect(login.error_message).to_contain_text("Your password is invalid!")


# TC-004 Empty Email and Password Fields
# REQ: REQ-1,REQ-5
def test_empty_email_password_fields(page: Page, base_url: str) -> None:
    login = SampleLoginPage(page, base_url)
    login.login("", "")
    expect(login.error_message).to_contain_text("Your username is invalid!")
