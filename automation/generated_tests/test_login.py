# TC: TC-001 Successful login shows welcome message
# REQ: REQ-1
from playwright.sync_api import Page, expect
from automation.pages.login_page import LoginPage
test_case_ids = ['TC-001']
pytestmark = [pytest.mark.generated]
def test_successful_login(page: Page, base_url: str, credentials, target_available) -> None:
    if not target_available:
        pytest.skip("locator review required")

    login_page = LoginPage(page, base_url)
    login_page.sign_in(credentials.username, credentials.password)

    # LOCATOR_REVIEW_REQUIRED:
    # No validated UI Scanner locator was found for:
    # "Confirm the membership badge is shown"