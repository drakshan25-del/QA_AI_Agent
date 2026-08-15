import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page import LoginPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]


# TC: TC-001 Successful admin login redirects to /dashboard within 3 seconds
# REQ: 55629644-77d1-43b4-bd3e-f77d5a35db8f
def test_successful_admin_login_redirect_timing(
    page: Page, base_url: str, credentials, target_available
) -> None:
    """Verify that successful admin login redirects to /dashboard within 3 seconds."""
    login = LoginPage(page, base_url)
    login.navigate_to_login()
    login.login(credentials.username, credentials.password)
    # Playwright's expect with timeout ensures redirect completes within 3s
    expect(page).to_have_url(f"{base_url}/dashboard", timeout=3000)


# TC: TC-008 Admin login fails with invalid email address
# REQ: 55629644-77d1-43b4-bd3e-f77d5a35db8f
def test_admin_login_fails_with_invalid_email(
    page: Page, base_url: str, target_available
) -> None:
    """Verify that login fails when a non-existent email address is used."""
    login = LoginPage(page, base_url)
    login.navigate_to_login()
    login.login("nonexistent@example.com", "AnyPassword123!")
    # User should remain on login page
    expect(page).to_have_url(f"{base_url}/login")
    # Error message should be displayed
    expect(login.error_message).to_be_visible()
