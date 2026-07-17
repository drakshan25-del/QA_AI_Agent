"""KeepMe Control Centre staging login tests.

AI-generated draft (run 6a0852f0), corrected by the human reviewer at the
FR-HITL-001 gate: the draft imported the sample-app page object and asserted
sample-app behaviour; corrected to KeepmeLoginPage and the behaviour observed
on staging (success navigates away from /login; failure stays and shows an
'Invalid Credentials' toast). Recorded as human correction effort (§15.2).
"""

import pytest
from playwright.sync_api import Page

from automation.pages.keepme_login_page import KeepmeLoginPage

pytestmark = [pytest.mark.generated]


# TC: TC-001 Valid credentials - Successful login
# REQ: 6eec0e7bcad64662be9983c7c5af8c89
def test_successful_login(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)
    login.assert_left_login()


# TC: TC-003 Invalid password - Login failure
# REQ: 6eec0e7bcad64662be9983c7c5af8c89
def test_invalid_password_login_failure(page: Page, base_url: str, credentials, target_available) -> None:
    login = KeepmeLoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, "not-the-real-password")
    login.assert_alert_contains("Invalid Credentials")
    login.assert_still_on_login()
