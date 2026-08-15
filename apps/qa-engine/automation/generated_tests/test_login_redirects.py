import time

import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page import LoginPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]


# TC: TC-001 Valid admin login redirects to /dashboard within 3 seconds
# REQ: REQ-LOGIN-REDIRECT, REQ-LOGIN-PERF
def test_valid_admin_login_redirects_within_3_seconds(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    page.wait_for_timeout(60_000)  # Wait for 60 seconds
    start = time.monotonic()
    login.login("demo@example.com", "change-me")
    expect(page).to_have_url(f"{base_url.rsplit('/login', 1)[0]}/dashboard")
    elapsed = time.monotonic() - start

    assert elapsed <= 3.0, f"Redirect took {elapsed:.2f}s, expected <= 3s"


# TC: TC-007 Already-authenticated admin visiting /login is redirected to /dashboard
# REQ: REQ-LOGIN-REDIRECT-AUTHED
def test_authenticated_admin_visiting_login_redirects_to_dashboard(page: Page, base_url: str, credentials, target_available) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    page.wait_for_timeout(60_000)  # Wait for 60 seconds
    login.login("demo@example.com", "change-me")

    dashboard_url = f"{base_url.rsplit('/login', 1)[0]}/dashboard"
    expect(page).to_have_url(dashboard_url)

    login.goto()

    expect(page).to_have_url(dashboard_url)
    expect(login.password_input).to_have_count(0)
