import uuid

import pytest
from playwright.sync_api import Page, expect

from automation.pages.login_page_updated import LoginPage
from automation.pages.user_creation_page_updated import UserCreationPage

pytestmark = [pytest.mark.generated, pytest.mark.ui]

# /admin requires an authenticated admin session (unauthenticated visits are
# redirected to /login), so every test logs in first via LoginPage.


def _login(page: Page, base_url: str, credentials) -> None:
    login = LoginPage(page, base_url)
    login.goto()
    login.login(credentials.username, credentials.password)


# TC: TC-001 Create user with all valid required fields
# REQ: 4e4757d0-0584-4187-9150-4887968d9718
def test_create_user_with_all_valid_fields(
    page: Page, base_url: str, credentials, target_available
) -> None:
    """A logged-in admin can create a user; the new row appears in the table."""
    _login(page, base_url, credentials)
    admin = UserCreationPage(page, base_url)
    admin.goto()
    expect(admin.form).to_be_visible()

    unique_email = f"new-admin-{uuid.uuid4().hex[:8]}@example.com"
    admin.create_user(
        name="John Smith",
        email=unique_email,
        password=credentials.password,
        role="admin",
    )

    # Success: flash confirms creation and the new admin appears in the table.
    expect(admin.flash).to_be_visible()
    expect(admin.flash).to_contain_text("created")
    expect(admin.row_for(unique_email)).to_be_visible()


# TC: TC-002 Submit user creation form with all required fields empty
# REQ: 4e4757d0-0584-4187-9150-4887968d9718
def test_submit_user_creation_form_with_empty_fields(
    page: Page, base_url: str, credentials, target_available
) -> None:
    """Submitting with required fields empty must not create a user.

    The form uses native `required` attributes, so the browser blocks the
    submission client-side: the page stays on /admin and no row is added.
    """
    _login(page, base_url, credentials)
    admin = UserCreationPage(page, base_url)
    admin.goto()
    expect(admin.form).to_be_visible()
    rows_before = admin.rows.count()

    admin.create_user(name="", email="", password="", role="")

    expect(page).to_have_url(f"{base_url}/admin")
    expect(admin.form).to_be_visible()
    assert admin.rows.count() == rows_before
